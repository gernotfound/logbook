# M3 Crash Consistency / Recovery Tests

This suite validates persistence recovery at the boundaries where a browser process may stop or a storage/network operation may fail.

Run only the deterministic recovery suite:

```bash
npm run test:recovery
```

Run the browser process-boundary check:

```bash
npm run test:e2e
```

Run the complete M3 gate:

```bash
npm run verify:m3
```

## Recovery contract

For every injected boundary, the durable state must be one of the two legal sides of the commit boundary:

1. the previous local state, when the IndexedDB transaction did not commit; or
2. the new local state plus a replayable journal, when the local transaction committed.

A remote Firestore commit that completed before a local acknowledgement was persisted may be delivered again. Replay must be idempotent: business data and causal metadata must not change on the duplicate delivery, and a later successful acknowledgement must clear the journal.

When acknowledgement persistence fails after a remote commit, `replicateJournal()` returns `local-pending` only if a fresh IndexedDB read proves the affected operation is still durable. If that proof fails, the result remains `failed`.

A newer local edit created while an older remote write is finishing must never be removed by the older acknowledgement.

Hydration after a remote commit with a lost local acknowledgement must preserve the pending operation and converge when the journal is replayed.

## Fault points covered

- local IndexedDB transaction fails before journal commit;
- session epoch changes after durable local commit but before remote delivery;
- remote failure before commit;
- remote commit succeeds but local acknowledgement write fails;
- local journal disappears after remote commit, which must remain a hard failure;
- a newer local edit lands between remote commit and acknowledgement;
- cloud hydration occurs while an already-committed operation is still pending locally.

The recovery suite runs with one worker because it intentionally injects failures into global IndexedDB primitives.

## Browser memory boundary

`e2e/offline.spec.ts` closes the original Playwright page, opens a new page while offline, and verifies both:

- a routine persisted as `UserData` survives from the IndexedDB envelope; and
- the active workout survives from device-local storage.

The new page has a fresh JavaScript realm, so module memory such as `running`, debounce state and in-memory store objects cannot satisfy the assertion. This complements the deterministic authenticated-journal replay checks in `tests/recovery/` without introducing production-only test hooks.
