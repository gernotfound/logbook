// Diagnostic mutation testing only. The normal M8 gate and production remain unchanged.
// This selection is deliberately bounded: Stryker's Vitest runner cannot run Playwright
// browser tests or the dedicated Firestore Emulator suite.
export const trialCases = {
  "secure-control-recovery": {
    "mutate": ["src/lib/sync/secureArchiveControlRecovery.ts"],
    "testFiles": ["tests/isolated/storage/secureArchiveControlRecovery.test.ts", "tests/isolated/storage/secure_archive_migration.test.ts"],
    "runner": "isolated"
  },
  "secure-archive-session": {
    "mutate": ["src/lib/sync/secureArchiveSession.ts"],
    "testFiles": ["tests/isolated/storage/secureArchiveSession.test.ts", "tests/isolated/storage/secure_archive_indexeddb.test.ts", "tests/isolated/storage/secureArchiveRepository.test.ts"],
    "runner": "isolated"
  },
  "secure-archive-repository": {
    "mutate": ["src/lib/sync/secureArchiveRepository.ts"],
    "testFiles": ["tests/isolated/storage/secure_archive_indexeddb.test.ts", "tests/isolated/storage/secureArchiveRepository.test.ts"],
    "runner": "isolated"
  },
  "archive-bootstrap": {
    "mutate": ["src/lib/sync/localArchiveBootstrap.ts"],
    "testFiles": ["tests/isolated/storage/localRepository.test.ts", "tests/isolated/storage/localArchiveBootstrap.test.ts"],
    "runner": "isolated"
  },
  "consent-reconciliation": {
    "mutate": ["src/lib/sync/localConsentReconciliation.ts"],
    "testFiles": ["tests/isolated/storage/localRepository.test.ts", "tests/isolated/health/audit_03_rejected_consent.test.ts", "tests/isolated/health/localConsentReconciliation.test.ts"],
    "runner": "isolated"
  },
  "csv": {
    "mutate": [
      "src/lib/csvExport.ts:7-25"
    ],
    "testFiles": [
      "tests/portability/csv_export_builder.test.ts",
      "tests/portability/sec01_csv_injection.test.tsx"
    ]
  },
  "meal-totals": {
    "mutate": [
      "src/lib/nutrition/calculateLoggedMealTotals.ts",
      "src/lib/utils/rounding.ts"
    ],
    "testFiles": [
      "src/lib/nutrition/calculateLoggedMealTotals.test.ts",
      "src/lib/nutrition/createLoggedMealItem.test.ts"
    ]
  },
  "meal-item": {
    "mutate": [
      "src/lib/nutrition/createLoggedMealItem.ts"
    ],
    "testFiles": [
      "src/lib/nutrition/createLoggedMealItem.test.ts"
    ]
  },
  "workout-duration": {
    "mutate": [
      "src/lib/calc/workoutDuration.ts"
    ],
    "testFiles": [
      "src/lib/calc/workoutDuration.test.ts"
    ]
  },
  "secure-id": {
    "mutate": [
      "src/lib/utils/date.ts:12-33"
    ],
    "testFiles": [
      "tests/schema/secure_id_generation.test.ts"
    ]
  },
  "cycle-limits": {
    "mutate": [
      "src/lib/calc/cycleLimits.ts"
    ],
    "testFiles": [
      "tests/training/training_cycle_limits_regression.test.ts"
    ]
  },
  "password-policy": {
    "mutate": [
      "src/lib/auth/passwordPolicy.ts"
    ],
    "testFiles": [
      "src/lib/auth/passwordPolicy.test.ts"
    ]
  },
  "sync-batching": {
    "mutate": ["src/lib/sync/syncBatching.ts"],
    "testFiles": ["tests/isolated/sync/syncBatching.test.ts"],
    "runner": "isolated"
  },
  "journal-retry": {
    "mutate": ["src/lib/sync/journalRetry.ts"],
    "testFiles": ["tests/isolated/sync/journalRetry.test.ts", "tests/isolated/sync/cloudKeyJournalRecovery.test.ts"],
    "runner": "isolated"
  },
  "replica-checkpoint": {
    "mutate": ["src/lib/sync/localReplicaCheckpoint.ts"],
    "testFiles": ["tests/isolated/sync/localReplicaCheckpoint.test.ts"],
    "runner": "isolated"
  },
  "cloud-integrity": {
    "mutate": ["src/lib/sync/localCloudIntegrity.ts"],
    "testFiles": ["tests/isolated/sync/localCloudIntegrity.test.ts"],
    "runner": "isolated"
  },
  "cloud-hydration": {
    "mutate": ["src/lib/sync/localCloudHydration.ts"],
    "testFiles": ["tests/isolated/storage/localRepository.test.ts", "tests/isolated/health/consentEpochRecovery.test.ts", "tests/isolated/sync/localCloudHydration.test.ts"],
    "runner": "isolated"
  },
  "journal-acknowledgement": {
    "mutate": ["src/lib/sync/localJournalAcknowledgement.ts"],
    "testFiles": ["tests/isolated/storage/localRepository.test.ts", "tests/isolated/sync/lateCommit.test.ts", "tests/isolated/sync/storeJournal.test.ts", "tests/isolated/sync/localJournalAcknowledgement.test.ts"],
    "runner": "isolated"
  },
  "consent-journal-recovery": {
    "mutate": ["src/lib/sync/localConsentJournalRecovery.ts"],
    "testFiles": ["tests/isolated/health/consentEpochRecovery.test.ts", "tests/isolated/health/localConsentJournalRecovery.test.ts"],
    "runner": "isolated"
  },
  "nutrition-conflict": {
    "mutate": ["src/lib/sync/localNutritionConflict.ts"],
    "testFiles": ["tests/isolated/storage/secure_archive_indexeddb.test.ts", "tests/isolated/sync/localSnapshotMergeMetadata.test.ts", "tests/isolated/domain/m8_domain_commit.test.ts", "tests/isolated/sync/storeJournal.test.ts", "tests/isolated/sync/localNutritionConflict.test.ts"],
    "runner": "isolated"
  },
  "pending-sequences": {
    "mutate": ["src/lib/sync/localPendingSequences.ts"],
    "testFiles": ["tests/isolated/sync/localPendingSequences.test.ts"],
    "runner": "isolated"
  },
  "sync-failure": {
    "mutate": ["src/lib/sync/syncFailure.ts"],
    "testFiles": ["tests/firebase/app_check_sync_semantics.test.ts"]
  },
  "monthly-tombstones": {
    "mutate": ["src/lib/sync/monthlyEntityTombstones.ts"],
    "testFiles": ["tests/isolated/sync/monthlyEntityTombstones.test.ts", "tests/isolated/sync/monthlyEntityTombstoneReplay.test.ts"],
    "runner": "isolated"
  },
  "business-normalization": {
    "mutate": ["src/lib/sync/businessNormalizationIntegrity.ts"],
    "testFiles": ["tests/isolated/domain/businessNormalizationIntegrity.test.ts"],
    "runner": "isolated"
  },
  "causal-compaction": {
    "mutate": ["src/lib/sync/causalCompaction.ts"],
    "testFiles": ["tests/gc/causalCompaction.test.ts"],
    "runner": "gc"
  }
};
const area = process.env.STRYKER_AREA ?? 'csv';

if (!Object.hasOwn(trialCases, area)) {
  throw new Error('Unknown Stryker area: ' + area);
}
export default {
  testRunner: 'vitest',
  // Stryker 10.1.1 rewrites tsconfig.json via an API removed from TypeScript 7.
  // The non-existent optional path suppresses that rewrite in this trial only.
  // Keep TypeScript checking in the normal M8 gate, not in this mutation sandbox.
  tsconfigFile: 'coverage/stryker-no-tsconfig-rewrite.json',
  vitest: {
    configFile: 'vitest.mutation.config.mjs',
    related: false,
    pool: 'forks',
  },
  mutate: trialCases[area].mutate,
  coverageAnalysis: 'perTest',
  concurrency: 2,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: { fileName: 'coverage/mutation-trial/mutation.json' },
  htmlReporter: { fileName: 'coverage/mutation-trial/index.html' },
  tempDirName: 'coverage/stryker-sandbox',
  thresholds: { high: 80, low: 60, break: null },
};
