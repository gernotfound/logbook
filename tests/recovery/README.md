# M3 Crash Consistency / Recovery Tests

This suite validates persistence recovery at the boundaries where a browser process may stop or a storage/network operation may fail.

Run only the recovery suite:

```bash
npm run test:recovery
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

A newer local edit created while an older remote write is finishing must never be removed by the older acknowledgement.

Hydration after a remote commit with a lost local acknowledgement must preserve the pending operation and converge when the journal is replayed.

## Fault points covered

- local IndexedDB transaction fails before journal commit;
- process/session epoch changes after durable local commit but before remote delivery;
- remote failure before commit;
- remote commit succeeds but local acknowledgement write fails;
- a newer local edit lands between remote commit and acknowledgement;
- cloud hydration occurs while an already-committed operation is still pending locally.

The recovery suite runs with one worker because it intentionally injects failures into global IndexedDB primitives.
