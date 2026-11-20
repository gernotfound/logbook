interface WeekRangeLabel {
  weekStart: string;
  weekEnd: string;
}

export function formatWeekIntervalTooltip(week: WeekRangeLabel | undefined, fallback: string): string {
  return week ? `Settimana ${week.weekStart} - ${week.weekEnd}` : fallback;
}

export function formatWeeklyVolumeTooltip(volumeKg: number, workoutCount?: number): string {
  const tons = (volumeKg / 1000).toLocaleString('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
  const workouts = workoutCount === undefined
    ? ''
    : ` (${workoutCount} ${workoutCount === 1 ? 'sessione' : 'sessioni'})`;
  return `Volume: ${volumeKg.toLocaleString('it-IT')} kg (${tons} t)${workouts}`;
}

export function formatVolumeAxisTick(value: unknown): string {
  const numeric = Number(value);
  return numeric >= 1000 ? `${(numeric / 1000).toFixed(1)} t` : `${numeric} kg`;
}
