# M4 Causal Metadata / Tombstone-Subtree GC

M4 reduces sync metadata without inventing a time-based safety rule.

Run the dedicated suite:

```bash
npm run test:gc
```

Run the complete M4 gate:

```bash
npm run verify:m4
```

## What is collected

A deleted ancestor field is a hierarchical causal barrier. Under Sync Protocol 3, a descendant `FieldStamp` may be removed only when the ancestor's persisted delete barrier (`deleteClock`, or the legacy tombstone event clock during migration) componentwise covers the descendant stamp and every hidden candidate clock.

`FieldStamp.clock` is the immutable event clock of the winner. A blocked contender advances only the cumulative document frontier `SyncMeta.clock`; it must not mutate the ancestor winner clock and thereby manufacture a false proof of subtree subsumption. Recreation can change the visible winner while the remove-wins delete barrier remains available for future arbitration.

Compaction is deterministic and idempotent. Zero-valued vector entries are canonicalized away because missing and zero coordinates are equivalent in vector comparisons.

## Terminal GC under Protocol 3

M4's age-based prohibitions remain unchanged: terminal tombstones are never collected because they are old. Protocol 3 can retire them only when the stable frontier — the componentwise minimum of every active replica checkpoint — covers the winner, delete barrier, legacy context and hidden candidates.

Replica membership is bounded to 16 slots. Expired/retired generations are fenced; slot reuse increments generation and continues the slot sequence. This is what makes removal of a stable terminal barrier safe against a stale device returning later.

With Protocol 3 as the first-account baseline, a client never turns terminal GC into a physical Firestore delete. If the last field disappears, the writer persists an empty `_schemaVersion` + `_sync.writer` shell so the transition remains attributable to the active replica generation.
## Required properties

The M4 suite checks:

- terminal tombstones remain without a stable frontier and are retired only when the stable frontier covers their complete causal state;
- descendants are removed only when the ancestor delete barrier covers the visible stamp and all hidden candidates;
- concurrent/unobserved descendants remain;
- bounded replica coordinates remain monotone; retired generations cannot publish stale journals;
- compaction is idempotent and deterministic;
- stale, concurrent, delete, recreation and out-of-order future deliveries produce the same business state and compacted causal state from original vs already-compacted metadata;
- the Firestore write boundary persists compacted `_sync`, returns the same causal state to acknowledgement, and keeps a fenced empty shell instead of issuing a physical delete;
- Firestore Rules fence stale replica generations and reject retired Protocol 1/2 writers from the first-account baseline onward.
