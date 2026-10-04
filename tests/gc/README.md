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

A deleted ancestor field is a hierarchical causal barrier. Under Sync Protocol 2, a descendant `FieldStamp` may be removed only when the ancestor's persisted delete barrier (`deleteClock`, or the legacy tombstone event clock during migration) componentwise covers the descendant stamp and every hidden candidate clock.

`FieldStamp.clock` is the immutable event clock of the winner. A blocked contender advances only the cumulative document frontier `SyncMeta.clock`; it must not mutate the ancestor winner clock and thereby manufacture a false proof of subtree subsumption. Recreation can change the visible winner while the remove-wins delete barrier remains available for future arbitration.

Compaction is deterministic and idempotent. Zero-valued vector entries are canonicalized away because missing and zero coordinates are equivalent in vector comparisons.

## What is deliberately NOT collected

M4 does **not** delete terminal tombstones merely because they are old. It also does not retire positive actor coordinates from the document frontier.

The current protocol has no replica-membership registry, stable frontier, or actor-retirement/fencing mechanism. A device can therefore return after an arbitrarily long offline interval with an old operation. Removing the final tombstone or forgetting a live actor coordinate on an age/TTL heuristic could resurrect deleted data or change conflict resolution.

Terminal tombstone retirement requires a future protocol that can prove every potentially stale replica is either causally past the deletion or fenced and forced to rebase. Until then, retaining the terminal barrier is the safe behavior.

## Required properties

The M4 suite checks:

- terminal tombstones remain;
- descendants are removed only when the ancestor delete barrier covers the visible stamp and all hidden candidates;
- concurrent/unobserved descendants remain;
- positive document-frontier actor coordinates remain;
- compaction is idempotent and deterministic;
- stale, concurrent, delete, recreation and out-of-order future deliveries produce the same business state and compacted causal state from original vs already-compacted metadata;
- the Firestore write boundary persists compacted `_sync` and returns the same compacted metadata to local acknowledgement.
