# M2 fuzz tests

Run the deterministic distributed/property suite with:

```bash
npm run test:fuzz
```

Every generated case is seed-driven. A failure prints a reproduction command such as:

```bash
LOGBOOK_FUZZ_SEED=123456789 npm run test:fuzz
```

To increase or reduce the number of generated cases per property while preserving deterministic seed generation:

```bash
LOGBOOK_FUZZ_CASES=1000 npm run test:fuzz
```

The full Milestone 2 regression gate is:

```bash
npm run verify:m2
```

Do not replace a failing seed with an exclusion. Reduce production failures to a deterministic regression test when practical, then keep the property that originally exposed the case.
