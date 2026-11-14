// SQLite julianday() is floating-point: CAST(epoch_ms) can be 1 ms behind
// the integer Worker timestamp at a session/lease boundary. Compose exact
// integer milliseconds instead, preserving fail-closed comparisons without a
// spurious rejection of a session created in the current millisecond.
export const D1_NOW_MS =
  "(CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
