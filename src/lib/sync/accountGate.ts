const key = (owner: string) => 'logbook:v2:' + owner + ':account-deletion';

export function isAccountDeletionPending(owner: string): boolean {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key(owner)) !== null;
}

export function markAccountDeletion(owner: string): void {
    localStorage.setItem(key(owner), JSON.stringify({ startedAt: Date.now() }));
}
