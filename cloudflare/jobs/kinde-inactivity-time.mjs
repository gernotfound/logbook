export const ACTIVITY_WRITE_INTERVAL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {number} timestamp */
function afterOneUtcYear(timestamp) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear() + 1;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}

/**
 * A confirmed observation can be newer than the stored marker by up to the
 * write interval. Use the latest possible UTC anniversary of that interval.
 * The anniversary can jump backwards at February 29, so also consider the
 * final instant before midnight when the interval crosses a day boundary.
 * @param {number | null} lastRecordedAtMs
 */
export function earliestKindeInactivityErasureAt(lastRecordedAtMs) {
  if (!Number.isSafeInteger(lastRecordedAtMs) || lastRecordedAtMs <= 0) return null;
  const latestPossibleVisit = lastRecordedAtMs + ACTIVITY_WRITE_INTERVAL_MS;
  if (!Number.isSafeInteger(latestPossibleVisit)) return null;
  const beforeMidnight = Math.floor(latestPossibleVisit / DAY_MS) * DAY_MS - 1;
  const possibleDates = [afterOneUtcYear(lastRecordedAtMs), afterOneUtcYear(latestPossibleVisit)];
  if (beforeMidnight >= lastRecordedAtMs) possibleDates.push(afterOneUtcYear(beforeMidnight));
  const earliest = Math.max(...possibleDates);
  return Number.isSafeInteger(earliest) && earliest > latestPossibleVisit ? earliest : null;
}
