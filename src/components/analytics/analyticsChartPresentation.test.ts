import { describe, expect, it } from 'vitest';
import { formatVolumeAxisTick, formatWeekIntervalTooltip, formatWeeklyVolumeTooltip } from './analyticsChartPresentation';

describe('shared analytics chart labels', () => {
  it('preserves volume formatting and singular/plural workout counts in both charts', () => {
    expect(formatWeeklyVolumeTooltip(1250, 1)).toBe('Volume: 1250 kg (1,25 t) (1 sessione)');
    expect(formatWeeklyVolumeTooltip(1250, 2)).toBe('Volume: 1250 kg (1,25 t) (2 sessioni)');
    expect(formatWeeklyVolumeTooltip(0, 0)).toBe('Volume: 0 kg (0,0 t) (0 sessioni)');
    expect(formatWeeklyVolumeTooltip(250)).toBe('Volume: 250 kg (0,25 t)');
  });

  it('keeps week-range titles and the Chart.js fallback label', () => {
    expect(formatWeekIntervalTooltip({ weekStart: '2026-10-19', weekEnd: '2026-10-25' }, 'F'))
      .toBe('Settimana 2026-10-19 - 2026-10-25');
    expect(formatWeekIntervalTooltip(undefined, 'F')).toBe('F');
  });

  it('preserves the kg-to-ton axis threshold', () => {
    expect(formatVolumeAxisTick(999)).toBe('999 kg');
    expect(formatVolumeAxisTick(1000)).toBe('1.0 t');
  });
});
