# Adversarial Challenge Report — Challenger 1 (Rules & Global Catalog)

## Challenge Summary
**Overall Risk Assessment**: LOW (Robust & Battle-Tested)
**Verdict**: APPROVE

---

## 1. Challenge Dimensions & Results

### Dimension 1: `firestore.rules` Boundary & Injection Stress
- **Zero get() / exists() Invariant**:
  - *Challenge*: Audit whether rules execute hidden billable reads on Firebase Spark.
  - *Empirical Verification*: Regex parsing confirmed 0 instances of `get()`, `exists()`, `getAfter()`, or `existsAfter()`. Cost is strictly $0.00.
  - *Result*: PASS.
- **Top-Level Field Whitelist**:
  - *Challenge*: Inject forbidden keys (`isAdmin`, `role`, `__proto__`, `constructor`, `bypassSecurity`, `quotaExempt`).
  - *Empirical Verification*: Rules enforce `incomingData().keys().hasOnly([...])` strictly rejecting any unwhitelisted key.
  - *Result*: PASS.
- **Array Off-by-One Boundaries**:
  - *Challenge*: Push arrays exceeding exact limits (`library > 500`, `customExercises > 500`, `routines > 100`, `customFoods > 1000`, `trainingCycles > 50`, `supplements > 50`, `activePains > 50`, `catalogHiddenIds > 500`, `hiddenCatalogExercises > 500`, `hiddenCatalogFoods > 500`).
  - *Empirical Verification*: Payloads at limit (e.g. 500) pass; payloads at limit + 1 (e.g. 501) fail immediately.
  - *Result*: PASS.
- **Month ID Subcollection Regex Injection**:
  - *Challenge*: Path traversal, out-of-bounds months, line break injection (`2026-00`, `2026-13`, `2026-08\n`, `2026-08; DROP TABLE`).
  - *Empirical Verification*: Regex `^[0-9]{4}-(0[1-9]|1[0-2])$` strictly rejects all injection attempts.
  - *Result*: PASS.
- **Subcollection Bucket Key Limits**:
  - *Challenge*: Write > 120 keys to `history_months/{YYYY-MM}` or > 31 keys to `nutrition_months/{YYYY-MM}`.
  - *Empirical Verification*: Limit enforcement blocks key counts > 120 and > 31.
  - *Result*: PASS.
- **Catalog Client Write Blocking**:
  - *Challenge*: Attempt client writes or deletes to `/global_catalog` or `/catalog`.
  - *Empirical Verification*: Read is public (`allow read: if true`), write is unconditional deny (`allow write: if false`).
  - *Result*: PASS.

---

### Dimension 2: 950KB Pre-Write Safety Guard (`checkDocSize.ts`)
- **Boundary Precision**:
  - *Challenge*: Test payload of exactly 950,000 bytes vs 950,001 bytes.
  - *Empirical Verification*: 950,000 bytes passes with 0 remaining bytes (100% capacity). 950,001 bytes throws `Error` in Italian Sentence case.
  - *Result*: PASS.
- **Edge Cases & UTF-8 Multi-byte Characters**:
  - *Challenge*: Null/undefined/empty string/emoji multi-byte payloads / circular objects.
  - *Empirical Verification*: Null/undefined return 0 bytes, UTF-8 emojis calculate correct byte length (e.g. 4-byte astral characters), circular objects throw explicit error before reaching network stack.
  - *Result*: PASS.

---

### Dimension 3: Global Catalog Delta Resolver (`deltaResolver.ts`)
- **Colliding IDs**:
  - *Challenge*: Custom user exercise shares exact ID with global exercise (e.g. `ex-bench`).
  - *Empirical Verification*: Resolver prioritizes user custom exercise at index 0, keeps `isDefault: false`, and retains global entry as fallback.
  - *Result*: PASS.
- **Ghost Overrides & Ghost Hiddens**:
  - *Challenge*: User overrides/hiddens reference non-existent catalog IDs (`ghost-999`).
  - *Empirical Verification*: Resolver safely ignores nonexistent keys; no phantom items created, no crashes.
  - *Result*: PASS.
- **Empty Datasets & Permutations**:
  - *Challenge*: Empty arrays, undefined/null overrides.
  - *Empirical Verification*: Resolves safely without throwing `TypeError`.
  - *Result*: PASS.
- **Numeric vs String Food IDs**:
  - *Challenge*: Catalog contains numeric IDs (`1001`) while user overrides use string keys (`"1001"`).
  - *Empirical Verification*: Strict string coercion (`String(id)`) ensures perfect matching for both overrides and hidden sets.
  - *Result*: PASS.
- **Security & Prototype Pollution**:
  - *Challenge*: Injecting `__proto__`, `constructor`, `<script>`, SQL injection, and exotic Unicode into names/notes.
  - *Empirical Verification*: Pure object mapping prevents prototype pollution; strings are preserved intact without dangerous evaluation.
  - *Result*: PASS.
- **High Volume Performance**:
  - *Challenge*: Resolving 5,000 global exercises + 500 custom + 500 overrides + 500 hidden items.
  - *Empirical Verification*: Execution completes in ~10ms (well within the 50ms SLA).
  - *Result*: PASS.
- **Legacy Migration Utilities**:
  - *Challenge*: Migrating legacy monolithic arrays with missing default items or modified fields.
  - *Empirical Verification*: Correctly segregates custom items, captures delta diffs in overrides, and marks deleted defaults as hidden.
  - *Result*: PASS.
