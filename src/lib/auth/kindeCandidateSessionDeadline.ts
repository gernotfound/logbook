export type KindeSessionDeadline = Readonly<{
    observedAtMs: number;
    expiresAtMs: number;
    requestWallMs: number;
    requestMonotonicMs: number;
}>;

export function isKindeSessionDeadlineCurrent(
    proof: KindeSessionDeadline, replicaLeaseUntilMs = proof.expiresAtMs,
): boolean {
    const deadline = Math.min(proof.expiresAtMs, replicaLeaseUntilMs);
    const wallElapsed = Date.now() - proof.requestWallMs;
    const monotonicElapsed = performance.now() - proof.requestMonotonicMs;
    if (!Number.isSafeInteger(deadline) || !Number.isFinite(wallElapsed) || wallElapsed < 0
        || !Number.isFinite(monotonicElapsed) || monotonicElapsed < 0) return false;

    // The primary observation occurred after the request began. Charging
    // all elapsed time since then bounds the remaining grant conservatively,
    // including transit and the final session read. The wall delta accounts
    // for sleep on browsers where the monotonic clock pauses while suspended.
    return Math.ceil(Math.max(wallElapsed, monotonicElapsed)) < deadline - proof.observedAtMs;
}
