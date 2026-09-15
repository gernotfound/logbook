export const PRIVATE_ACCOUNT_COLLECTIONS = [
  'history_months',
  'nutrition_months',
  'telemetry_errors',
  'telemetry_events',
  'telemetry_anomalies',
] as const;

export type PrivateAccountCollection = typeof PRIVATE_ACCOUNT_COLLECTIONS[number];
export type AccountDeletionStatus = 'requested' | 'deleting' | 'verifying' | 'complete' | 'failed';

export interface AccountDeletionCursor {
  phase: 'requested' | 'revoking' | 'collection' | 'root' | 'verifying' | 'auth' | 'complete';
  collection?: PrivateAccountCollection;
  deletedBatches?: number;
}

export interface AccountDeletionJob {
  uid: string;
  requestedAt: unknown;
  updatedAt: unknown;
  status: AccountDeletionStatus;
  cursor?: AccountDeletionCursor;
  attempts: number;
  receiptHash: string;
  retryable?: boolean;
  leaseOwner?: string;
  leaseUntil?: unknown;
  lastError?: {
    phase: string;
    message: string;
  };
}

export interface AccountDeletionPublicStatus {
  uid: string;
  status: AccountDeletionStatus;
  attempts: number;
  cursor?: AccountDeletionCursor;
  requestedAt?: string;
  updatedAt?: string;
  retryable?: boolean;
  error?: string;
}
