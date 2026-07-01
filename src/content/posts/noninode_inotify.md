---
author: Riad
pubDatetime: 2026-05-31T12:00:00Z
title: Who uses the CPU when you type `tail -f`?
slug: who-uses-the-cpu-tail-f
featured: false
draft: false
description: "This post started with running tail -f in one terminal and echo >> in another, and finding a red anon_inode:inotify entry in /proc. It unpacks that discovery and answers the question: who actually does the work when you run tail -f?"
---

Run `tail -f file` in one terminal and `echo "something" >> file` in another. The appended line shows up in the first terminal instantly — yet `tail`, which looks like it's watching the file, sits at 0% CPU. So who is actually doing the work? It starts with a file descriptor that isn't a file.

## Table of contents

## The file descriptor that isn't a file

![Output of ls on the tail process's file descriptors, showing a red anon_inode:inotify entry](@/assets/images/ls_pgrep_tail.png)

Run this:

```bash
ls -l /proc/$(pgrep tail)/fd/
```

You get a red `anon_inode:inotify` entry. Try to `cat` it:

```bash
cat /proc/$(pgrep tail)/fd/4
```

![cat returning a No such device or address error](@/assets/images/no_such_file.png)

...and you get a "No such device or address" error.

Isn't everything in Linux a file? There are some exceptions, and this is one of them. `inotify` is a notification instance, created here by `tail -f` (it could be created by something else). It's the mechanism that tells `tail` "bytes were appended to the file — go print them."

## Step 1 — create the station

`inotify` is a notification station, empty when created. You're telling the kernel "set up a station for me, I'll use it later." It's built by the syscall `inotify_init1(IN_NONBLOCK)`.

The `IN_NONBLOCK` argument is what separates this call from `inotify_init()`. It sets `O_NONBLOCK` on the inotify fd and governs one thing: what `read(fd4)` does when the event queue is empty. With it, `read` returns immediately with `EAGAIN`. Without it, `read` blocks until an event arrives.

> Note: `read(fd4)` returns **event records** describing what happened — not the file's appended bytes. The actual bytes are read separately, from the file's own descriptor (fd 3). More on that at the end.

The call returns the fd of the station (`fd 4`) and sets up an empty watch list and an empty event queue.

![The inotify instance at creation, with three empty lists: watch list, event queue, wait queue](@/assets/images/inotify-1-creation.svg)

## Step 2 — register the file

Now `tail` adds the file to the station:

```c
inotify_add_watch(fd4, file, IN_MODIFY | IN_DELETE_SELF | ...);
```

The third argument is a bitwise OR of the events `tail` cares about — think of them as light switches (`1 | 0 | 1 | 1 ...`). (Real `tail` asked only for `IN_MODIFY` here, you'll see that in the trace.)

The kernel creates a small record — the **watch** — and attaches it to the file's inode:

```text
WATCH (a kernel struct, hanging off the inode):
   ├─ which inotify instance it belongs to   (fd 4's station)
   ├─ the event mask                          (IN_MODIFY | ...)
   └─ its id number                           (wd = 1)
```

Think of it as a sticky note on the file's inode: "if one of these events (MODIFY, DELETE_SELF, ...) happens to me, send a message to station fd 4, tagged wd 1."

The call returns the **wd** (watch descriptor), which `tail` stores in its own `wd[]` array.

![The watch list now holding wd 1, plus a watch-note on the file's inode pointing back to fd 4](@/assets/images/inotify-2-add-watch.svg)

Two side lessons before the next step:

- `poll` is a syscall whose job is: "here is a list of fds, put me to sleep, and wake me when any of them has something to read — and tell me which."
- fds 0, 1, 2 are reserved for STDIN, STDOUT, STDERR.

## Step 3 — wait with poll

`tail` fills in a `pollfd` form for the station (fd 4) — "wake me when this is readable":

```c
struct pollfd {
    int   fd;        // which fd is this form about?
    short events;    // what am I waiting for on it?   ← tail fills this in
    short revents;   // what actually happened?         ← poll fills this in
};

pollfds[0] = { fd: 4 /* station */, events: POLLIN };  // wake me if fd 4 has an event
```

`POLLIN` means "there's something to read." (`POLLOUT` is for writable, we only care about `POLLIN` here.)

Then it calls `poll(pollfds, 1, -1)`. The `-1` means "sleep until something happens," so this call blocks `tail`.

But `poll` does not watch fd 4 — if it did, our "0% CPU" claim would be false. So how does it work? On the way in, `poll` does one thing and then sleeps: for each fd in its list (here, just the inotify fd), it leaves a note on that fd's **wait queue** — "these processes are waiting on me, wake them when I get activity." Then it marks `tail` BLOCKED and sleeps. That registration is all `poll` does. It is not watching.

![tail registered on the wait queue, blocked and asleep at 0% CPU, while the event queue is still empty](@/assets/images/inotify-3-poll.svg)

## Step 4 — echo writes

`echo "something" >> file` runs in the second terminal. Now **echo** is the one using the CPU, not `tail`. `echo` issues a `write` to the kernel, and inside that same `write` the kernel does several things: it appends the bytes, looks at the file's inode, sees that wd 1 is watching this kind of event, queues an `IN_MODIFY` event into fd 4's queue, and then — finding `tail` parked on the wait queue — flips it from BLOCKED to READY. `write` returns, `echo` exits.

So the writer paid the cost, then left.

![echo's write queuing an event and walking the wait queue to wake tail, all three lists now in play](@/assets/images/inotify-4-echo-write.svg)

## Step 5 — tail wakes up

When the scheduler next picks a process to run, `tail` is READY, so it runs. Its `poll` call returns, having filled in `revents` so `tail` knows which fd woke it:

```c
poll(pollfds, 1, -1);   // tail sleeps here... echo writes... tail wakes, poll returns

// poll has filled in revents. tail checks it:
if (pollfds[0].revents & POLLIN)   // did fd 4 (the station) become readable?
    read(fd4, ...);                // YES → read the event from the station
```

`tail` reads the event from fd 4, then reads the new bytes from the file (fd 3), prints them, calls `poll` again, and blocks — back to 0% CPU.

## So why does a non-file have a file descriptor?

For the sake of the abstraction, so `read` and `poll` work on a notification queue with no special API. `poll` doesn't know or care that the fd in the array is a fake-inode kernel object, it treats it as just another fd. The exception exists to preserve the rule: everything is a file, even when it isn't.

## Don't trust me — check it yourself

Run `tail` under `strace` in one terminal and `echo` in another:

```bash
# terminal 1
strace -e trace=inotify_init1,inotify_add_watch,poll,read tail -f file

# terminal 2
echo "something" >> file
```

![strace output showing inotify_add_watch, poll hanging, then read on fd 4 returning an event and read on fd 3 returning the text](@/assets/images/strace_tail_inotify.png)

Long story short: `inotify_add_watch(...) = 1` registers the watch. `poll(...)` **hangs** and that frozen line is `tail` blocked at 0% CPU. The moment you `echo`, `read(4, ...) = 16` returns a 16-byte event (not your text), then `read(3, ...)` reads the actual `"something\n"` from the file. Two reads, two fds — the event on fd 4, the content on fd 3.

Thanks for reading. See you in the next one.