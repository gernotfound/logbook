# Temporary picomatch security backport

This is a repository-local, non-published copy of upstream `micromatch/picomatch` tag `4.0.7` (MIT).

The source changes in `lib/parse.js` adapt both proposed upstream fixes [#237](https://github.com/micromatch/picomatch/pull/237) and [#238](https://github.com/micromatch/picomatch/pull/238) for CVE-2026-112366 / GHSA-fc5q-39xc-vjpf:
- Single-branch repeated extglobs containing a bare `*` are collapsed into one non-nested quantifier, retaining normal matching semantics (`+(*)`, `+(*a)`).
- Ambiguous quantifier-leading complex branches, or a repeated inner extglob followed by more branch content, are treated as unsafe and literalized.
- Two unrelated source constructs are simplified without changing behavior: an unused catch binding is omitted and `new RegExp(value)` becomes `RegExp(value)`. This preserves the repository's mandatory lint/quality rules without exceptions.

The repository's native Node regression checks cover the documented vulnerable globs, ordinary glob matching, and unknown complex branches. These do **not** substitute for independent security review or the upstream package's complete test suite.

Knip tracks this copied CommonJS module as a separate package: `posix.js` is a supported subpath entrypoint and `lib/utils.js` contains dynamically required exports. Both are declared as entrypoints in `knip.json` so dead-code analysis retains coverage of the rest of the project without false positives on the vendored CommonJS boundary.

`4.0.8-logbook.0` is **not** an official picomatch release. Its version distinguishes the internal fork from the vulnerable registry version; it must not be used as proof of upstream remediation. Installation is forced through the root npm override and checked with `tests/security/picomatch-backport.node.mjs`. `npm audit` does not audit the code of local `file:` dependencies like a registry-published package: a green audit is necessary but **not sufficient** to establish this fork's security.

**Replacement plan:** when upstream publishes a verified safe release, remove this entire directory, the override, direct dev dependency, and dedicated backport tests; regenerate the npm lockfile and re-run exact-SHA CI, including `npm audit --audit-level=high`. Until then the fork is locally maintained and requires independent code review.
