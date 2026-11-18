# Temporary picomatch security backport

This is a repository-local, non-published copy of upstream `micromatch/picomatch` tag `4.0.7` (MIT). The sole behavioral change in `lib/parse.js` backports the proposed safeguard from [upstream PR #238](https://github.com/micromatch/picomatch/pull/238) against CVE-2026-112366 / GHSA-fc5q-39xc-vjpf. A pre-existing, unused catch binding in that same file is also omitted to satisfy the repository's zero-warning lint baseline.

`4.0.8-logbook.0` is **not** an official picomatch release. Its version distinguishes this patched copy from vulnerable `4.0.7`; it must not be used as proof of upstream remediation. Installation is forced through the root npm override and checked with `tests/security/picomatch-backport.node.mjs`.

**Replacement plan:** when upstream publishes a verified safe release, remove this entire directory, the override, direct dev dependency, and dedicated backport tests; regenerate the npm lockfile and re-run the exact-SHA CI, including `npm audit --audit-level=high`. Until then the fork is locally maintained and requires independent code review.
