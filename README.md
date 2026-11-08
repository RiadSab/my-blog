# blog.sabti.dev

Riad Sabti's blog. Built with [Zola](https://www.getzola.org/) (a single
program, no npm) and styled to match [sabti.dev](https://sabti.dev/).

## Write a post

Create a folder named after the post's URL slug, with an `index.md` inside:

```
content/posts/my-new-post/
├── index.md
└── diagram.svg        ← images live next to the post
```

```toml
+++
title = "My new post"
description = "One sentence shown on the home page and in link previews."
date = 2026-11-08T10:00:00Z
# draft = true         ← uncomment to keep it unpublished

[extra]
author = "Riad Sabti"
toc = true             # optional: adds a collapsible "Contents" box
+++

Text in Markdown. Images by file name: ![What it shows](diagram.svg)
```

The post is published at `/posts/my-new-post/` and appears on the home page,
newest first.

## Run locally

```sh
zola serve      # http://127.0.0.1:1111, reloads on save
zola build      # writes the site to public/
zola check      # also checks every link
```

## Deploy (Cloudflare Pages)

- Build command: `sh build.sh`
- Output directory: `public`

`build.sh` downloads the Zola version pinned inside it and builds the site.
Cloudflare's own Zola is older and builds this site wrong, so don't use
plain `zola build` there. To upgrade Zola, change `ZOLA_VERSION` in
`build.sh` and install the same version locally.

`static/_redirects` sends the old Astro pages (`/about/`, `/archives/`,
`/search/`, `/tags/…`) to their new homes.

## Where the design lives

- `static/style.css`: a copy of the portfolio's stylesheet (colors, fonts,
  nav, footer, light/dark switch). Change it in the portfolio, then copy it
  here.
- `static/theme.js`: the light/dark switch, also shared with the portfolio.
- `static/blog.css`: blog-only styles (post list, post body, code, tables).
- `highlight/coffee-*.json`: the code-highlighting colors for light and dark.
- `templates/`: the HTML for the home page, posts and the 404 page.
