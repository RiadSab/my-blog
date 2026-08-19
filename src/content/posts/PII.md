---
author: Riad Sabti
pubDatetime: 2026-08-19T10:00:00Z
title: "Pseudonymous or anonymous test data?"
slug: pii-pseudonymization-ff1
featured: false
draft: false
description: "I just want to show you some pseudonymization ideas, and the point where they stop working."
---

## Table of contents

## The beginning

A lot of companies hand their IT work to another IT company: responsibility for the product, deadlines, and so on. The original company owns the customer data. Does it hand that data over for the second company to test with?

If real PII is involved, that usually violates purpose limitation under GDPR. The transfer itself can be lawful under a processing agreement. The problem is that the data was collected to provide a service, not to populate a test environment. The same applies when the original company tests internally and the data never leaves the building.

The obvious fix is to generate fake rows. I don't think that works, for three reasons: consistency, shape, and query behaviour, joins in particular.

So I built this pseudonymization service to satisfy those constraints. The code is on [GitHub](https://github.com/RiadSab/pii-pseudonymization).

## Big picture, inputs and outputs

The service is an implementation of FPE (Format Preserving Encryption). As the name says, it preserves the shape of the input while changing it completely. We use that to encrypt real data and produce a replacement usable in tests.

Example: a CIN like `BK123456` becomes `BH294013`. Same format, same length, and the same input always produces the same output, so references stay consistent across tables.

![The pipeline: production database, Spring Batch reader, a FieldConfig registry resolving column names to field types with one derived key each, the FF1 and HMAC dictionary transformers, writer, test database with joins intact](@/assets/images/PII/01-pipeline.svg)

FF1 is the single node in the middle of that diagram. The rest of this post opens it up, then comes back out to the layer around it.

## Is it worth it

You might say fake test data is fine and produces the same outcomes as real data. You may be right. But here is my counter-argument.

Generated data loses its human shape. By shape I mean the mistakes and the behaviours that are not machine-generated, and those are exactly the failure sources we are trying to catch in testing. If you write the fields by hand, or have an AI write them, you produce the bugs you already had in mind. What about the ones you didn't? I don't think you can enumerate them yourself. If you can, tell me how, I'm interested.

The second reason is consistency. Data grows, and you will want to join another table. The references have to keep matching.

## The maths under it

### The setup

FF1 takes an input of `n` characters drawn from an alphabet of size [`radix`](#radix). For a Moroccan MSISDN I cut the constant prefix, leaving 8 digits (`0618282930` becomes `18282930`), and pass the prefix as the [tweak](#tweak). The tweak is what stops two numbers that differ only by their prefix from producing the same output. The result is another 8-digit number, and the prefix is reattached.

The spec requires `radix^len >= 1,000,000`. Below a million possible values, ten Feistel rounds do not mix enough and the permutation becomes distinguishable from random. That is why you cannot run this on something like a two-letter country code.

FF1 takes the value as an [array of numerals](#numeral-string), each one in `[0, radix)`, ordered most-significant first, and splits it into two halves. Note this is not the same as an integer: `{0, 6, 1, 8}` keeps its leading zero, `618` does not.

Compute `b = ceil(ceil(v * log2(radix)) / 8)`: how many bytes are needed to hold the largest value a `v`-numeral string can represent. For `v = 4`, `radix = 10`, the largest value is `9999`, which needs 14 bits, so `b = 2`.

Compute `d = 4 * ceil(b / 4) + 4`: how many bytes of pseudorandom output the round needs. For `b = 2`, `d = 4 * 1 + 4 = 8`.

### Why `d` has that `+4`

Or: why the spec asks for more random bytes than the value needs.

It is not `y` that needs to be uniform. `y` already is, because it comes straight out of [AES](#block-cipher-aes). What needs to be uniform is `c`, which is `y` reduced mod `radix^m`.

`y` lives in `[0, 2^(8d))`, a power of two. `radix^m` is never a power of two. So the reduction always leaves some residues reachable one more time than others, and the size of that imbalance is roughly `radix^m` divided by `2^(8d)`.

|  | `d = b` (no margin) | `d = b + 4` (actual spec) |
|---|---|---|
| `y`'s range | `2^16` = 65,536 | `2^64` |
| modulus | `10^4` | `10^4` |
| ratio | 6.55 | 1.8 x 10^15 |
| occurrences per residue | 7 or 6 | 1,844,674,407,370,956 or ...955 |
| skew | 1 in 6, detectable in a few dozen samples | 1 in 1.8 x 10^15, undetectable |

In both cases the imbalance is exactly one occurrence. What changes is what that one is a fraction of. The four extra bytes do not remove the bias, they dilute it below anything measurable.

### The `P` block

A 16-byte header prepended to every round's PRF input. It encodes version, method, the addition flag, radix, `n`, `u`, and the tweak length. Binding those parameters into the MAC means a ciphertext produced under one configuration cannot be decrypted under another, even with the same key.

### Ten rounds

![Ten Feistel rounds: the input splits into halves A and B, each round combines A with F(B, i) by modular addition and swaps the halves, ending in ciphertext A concatenated with B](@/assets/images/PII/02-ten-rounds.svg)

And one round, opened up:

![Inside one encryption round: Q is built from the tweak, the round number and B; R is the CBC-MAC of P concatenated with Q; S expands R to d bytes; y = NUM(S); c = (NUM(A) + y) mod radix^m becomes the new B while A takes the old B unchanged](@/assets/images/PII/03-round-encrypt.svg)

Each round scrambles one half using the other, which is what we split the numerals in two for. The value doing the scrambling is `y`, and the whole round exists to produce it and add it to `A`.

`y` has to be derived from `B`, never from `A`. `B` passes through the round untouched and becomes the next `A`, so at decryption time it is still sitting there in the clear and `y` can be recomputed.

To get `y` we first need `Q`. The round encodes `B` into `b` bytes and appends that to the tweak and the round number `i`, with zero padding in between so the whole thing lands on a 16-byte boundary: `Q = T || 0-pad || i || NUM(B)`. The round number is in there so that every round is different. The tweak is in there so that the same value under the same key can produce different output, which is how `0612345678` and `0712345678` avoid encrypting to the same number.

`P || Q` then goes through a CBC-MAC under AES, which produces a 16-byte `R`. If the round needs more than that, `R` is extended with `AES(R xor 1)`, `AES(R xor 2)`, and so on. The result is truncated to `d` bytes and read as a big-endian integer, and that is your `y`.

The rest is arithmetic. `c = (NUM(A) + y) mod radix^m`, where `m` is `u` on even rounds and `v` on odd ones, `c` is written back out as `m` numerals to give `C`, and the halves swap: `B` becomes the new `A`, and `C` becomes the new `B`.

### But who the hell is Feistel

Horst Feistel was a German-American cryptographer at IBM. He did not invent FPE. He invented the construction that FPE, DES, Blowfish, Twofish, and Camellia are all built out of.

What he showed is that you can build a strong invertible cipher from a non-invertible round function. My round function is built on AES, but the round function as a whole cannot be run backwards, and never needs to be: it assembles `Q`, runs a [CBC-MAC](#cbc-mac), expands the result, and reduces it. Information is destroyed at several of those steps. Before Feistel, cipher designers had to make every component reversible, which is a severe constraint on how much scrambling you can do.

The other consequence: encryption and decryption become the same circuit, because decryption is the same rounds with the schedule reversed. In 1971 that halved the chip cost, and it is why the structure won.

## Decryption

This sounds like magic. The decryption steps are the same as encryption, except `i` runs from 9 down to 0, and `Q` is built from `A` instead of `B`. The round function is never inverted. That is how Feistel works.

The first trick is that the combine step needs a [group operation](#group-operation) with both closure and invertibility. [XOR](#xor) satisfies both, which is why every textbook cipher uses it, but only when the domain is a power of two. When it isn't, XOR produces values outside the domain.

For a domain of 100:

```text
99  = 1100011
30  = 0011110
XOR = 1111101 = 125     outside the domain, not a 2-digit string
(99 + 30) mod 100 = 29  inside, always
```

Our MSISDN domain is `10^8`, not a power of two, so the operation is [modular addition](#modular-arithmetic) and its inverse is modular subtraction, rather than a second XOR.

The phrase to take away: **Feistel requires a group operation on the domain.**

The second trick is that `B` passes through in the clear. It becomes the new `A` untouched, so when decryption reaches round `i`, the value it needs to rebuild `Q` is sitting right there. That is why `y` comes out identical in both directions.

![Inside one decryption round: the same P block and the same expansion produce an identical y, but Q is built from A, the combine step is c = (NUM(B) - y) mod radix^m, and the halves move the other way](@/assets/images/PII/04-round-decrypt.svg)

### Why you need decryption

- If a subscriber requests erasure, you must locate their rows in every copy, including the pseudonymized one.
- Investigation: a test run surfaces a bug that only reproduces on one record, and an audited role re-identifies it.
- The third reason is mine: I need the decryption path to test the encryption.

## The layer above FF1

FF1 knows nothing about the fields it is transforming. It does not tell you which key or which domain to use for which column. That is my service.

### Key derivation

One master key, with [HKDF](#hkdf) deriving one key per field type, so a leaked MSISDN key does not leak the CIN key.

### Field type

Caller and callee phone numbers both resolve to the same field type: phone number. Each type has a `FieldConfig` describing which transformer to use (FF1 or dictionary substitution) and how to parse and format the value.

This is why the foreign key survives. `cdr.caller_msisdn`, `cdr.callee_msisdn`, and `subscribers.msisdn` all resolve to one field type, so they get the same key, the same radix, and the same tweak, and therefore the same output for the same input.

### Dictionary substitution

For fields like `first_name` and `city`, encryption cannot produce a meaningful value, so I use a dictionary instead. Hand me `Casablanca` and I compute `HMAC("Casablanca") mod dictionary.size()` to get an index, then return the city at that index.

This is not encryption. It is a keyed [HMAC](#hmac) lookup over a small public domain, and it has a failure mode I measure below.

## Frequencies

You might think that pseudonymizing eight fields makes it nearly impossible to identify the person behind them. It doesn't. Each field narrows the search area instead of widening it, and frequency analysis is how you exploit that: the most common name in the country maps to whichever name is most common in the transformed data.

![Two SQL queries side by side: the top five cities in the real table are Casablanca 210, Autre 142, Rabat 79, Marrakech 73, Fes 69; in the pseudonymized table they are Larache 283, Al Hoceima 150, Midelt 81, Imzouren 79, Ksar El Kebir 69](@/assets/images/PII/freq.png)

The names changed, the shape of the distribution did not. Whoever reads the pseudonymized table knows the top city is Casablanca, because it is still the top city.

[High-cardinality](#cardinality) fields resist frequency analysis, because every value occurs once and there is no distribution to rank. But that is exactly what makes them useful to an attacker: a unique input maps to a unique output, which is a persistent handle for one person. Find one row you can attribute using the columns I did not transform (`start_time`, `duration_sec`, `cell_id`), read the pseudonym off it, and you have that subscriber's entire record set without ever learning their real number.

### Sweeney's result

Latanya Sweeney showed that ZIP code, date of birth, and sex, three [quasi-identifiers](#cardinality) that identify nobody on their own, uniquely identify roughly 87% of the US population. Every field you add narrows the search area.

## Pseudonymization is not anonymization

This service is not the ultimate solution. Pseudonymized production data is the fallback for cases synthetic data cannot cover, not the default path.

It does not provide anonymity. Even if you delete the key and the decryption path, you are still exposed to the frequency analysis above, because the key hides the mapping, not the structure. `GROUP BY pseudo_city` does not use the key.

Real randomness would destroy the frequency signal, and it would destroy the joins in the same stroke. That is the price of joins. You cannot keep one and delete the other.

## Demonstration

### Zero orphans

![SQL query counting orphaned callees after a left join between cdr_pseudo and subscribers_pseudo, alongside distinct callee counts: 0 orphans, 1000 distinct before, 1000 distinct after](@/assets/images/PII/zero_orph.png)

Zero orphaned foreign keys in both directions, and 1,000 distinct MSISDNs in, 1,000 distinct out. The second number matters as much as the first: a [bijection](#bijection) cannot merge two inputs into one output, so if the distinct count had dropped, the cipher would be broken.

The FF1 implementation is validated against the NIST FF1 sample vectors, including the published intermediate values for `b`, `d`, `P`, and the per-round `Q`, `R`, `S`, and `y`.

### Dictionary substitution is not a bijection

The city dictionary is small, and `HMAC(city) mod dict.size()` maps an unbounded input space onto a few dozen slots. Collisions are not a risk there, they are the definition of the function.

![SQL query listing pseudonymized cities that more than one real city maps to: Al Hoceima from Autre and Laayoune, Laayoune from Kenitra and Settat, Larache from Casablanca and Marrakech, Midelt from Meknes and Oujda](@/assets/images/PII/dicti_is_not_bijection.png)

Four of the 28 cities merged. Casablanca and Marrakech both became Larache, whose 283 subscribers are exactly 210 + 73.

This is a second leak, and a different kind from the frequency one. A collapsed `COUNT(DISTINCT city)` is information in itself, and it breaks any test whose behaviour depends on city cardinality. Fixing it means a keyed permutation over dictionary indices rather than a hash, which for a 28-element domain needs cycle-walking: correct, but with a variable iteration count and far below the round count FF1 was analysed for. Small-domain FPE is where the standard itself stops. I have not implemented it.

## Serious FPE products

Google Cloud Sensitive Data Protection offers pseudonymization, and one of its three tokenization methods is format-preserving encryption using FPE-FFX with a cryptographic key. Google's implementation uses FF1 specifically, the same ten-round Feistel described above.

## The end

I still have to swap the raw key for a KMS-wrapped one. But I may have done it by the time you read this.

See you in the next one. Arrivederci.

## Appendix: what this post assumes you know

<strong id="bijection">Bijection.</strong> A function mapping each input to a distinct output, with nothing left over. No two inputs share an output, and every output is reachable. This is why decryption is possible at all, and it is what the distinct-count query measures.

<strong id="group-operation">Group operation.</strong> A binary operation on a set with two properties: closure, meaning combining two elements gives an element of the same set, and invertibility, meaning that given the result and one operand you can recover the other. XOR is one. Modular addition is another.

<strong id="xor">XOR.</strong> Bitwise comparison returning 1 where the bits differ. Its useful property is that applying the same value twice returns the original.

<strong id="modular-arithmetic">Modular arithmetic.</strong> `a mod n` is the remainder after dividing by `n`, always landing in `[0, n)`. It appears throughout this post because it forces values back inside a fixed range.

<strong id="radix">Radix.</strong> The size of an alphabet. Decimal digits are radix 10, hexadecimal is radix 16.

<strong id="numeral-string">Numeral string versus integer.</strong> `{0, 6, 1, 8}` is four symbols including a leading zero. `618` is a number that lost it. FF1 operates on the first, which is what makes the format survive.

<strong id="block-cipher-aes">Block cipher and AES.</strong> A keyed, reversible permutation over fixed-size blocks. AES works on 128 bits. For this post you only need to know it is a strong scrambler.

<strong id="cbc-mac">CBC-MAC, and PRF more generally.</strong> Chaining a block cipher across a message to produce one fixed-size output that looks random and depends on every input byte. Used inside the round function.

<strong id="hmac">HMAC.</strong> A keyed hash. Different from encryption in the way that matters here: it is one-way, and it compresses a large input space into a small output space, so collisions are inherent.

<strong id="hkdf">HKDF.</strong> A construction for deriving several independent keys from one master key.

<strong id="tweak">Tweak.</strong> A public, non-secret input that changes the permutation without changing the key. Two values encrypted with the same key but different tweaks produce different outputs.

<strong id="cardinality">Cardinality and quasi-identifiers.</strong> Cardinality is the number of distinct values in a column. A quasi-identifier is a field that identifies nobody on its own but does so in combination with others.
