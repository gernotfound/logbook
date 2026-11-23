import { describe, test, expect, beforeEach } from 'vitest';
import React from 'react';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders, emptyUserData } from '../../setup';
import { Logic } from '../../../src/lib/logic';
import TrainingRoutines from '../../../src/components/Training/TrainingRoutines';
import MuscleModel from '../../../src/components/Training/MuscleModel';
import { useHomeView } from '../../../src/hooks/useHomeView';

describe('Muscle presentation and home metrics', () => {
  beforeEach(() => { localStorage.clear(); });

  describe('3. MuscleModel & Compact Reps in TrainingRoutines', () => {
    test('MuscleModel is always visible in routine creation even with zero exercises', () => {
      const { container } = renderWithProviders(<TrainingRoutines />, {
        userData: { ...emptyUserData, routines: [] }
      });

      // Click "Crea scheda"
      const createBtn = screen.getByRole('button', { name: 'Crea scheda' });
      act(() => {
        fireEvent.click(createBtn);
      });

      // An unrelated SVG icon must not satisfy the muscle map assertion.
      const editor = container.querySelector('#routine-creation-form');
      expect(editor).not.toBeNull();
      const map = screen.getByRole('img', { name: 'Mappa dei muscoli, vista anteriore e posteriore' });
      expect(editor?.contains(map)).toBe(true);
      expect(map.querySelector('[data-muscle-path="chest-upper-left"]')).not.toBeNull();
    });
  });

  describe('6. MuscleModel Custom Colors & useHomeView Volume/Dropset/Fatigue', () => {
    test('MuscleModel applies custom colors from both atomic SVG path IDs and logical muscle IDs', () => {
      const customColors: Record<string, string> = {
        'chest-upper-left': '#ef4444',
        'back': '#f97316'
      };

      const { container } = renderWithProviders(
        <MuscleModel muscleColors={customColors} interactive={false} />
      );

      const chestPath = container.querySelector('[data-muscle-path="chest-upper-left"]');
      expect(chestPath).not.toBeNull();
      expect(chestPath?.getAttribute('style')).toContain('fill: rgb(239, 68, 68)');

      // 'back' is a logical group mapping to lats, traps, etc.
      const latsPath = container.querySelector('[data-muscle-path="lats-mid-left"]');
      expect(latsPath).not.toBeNull();
      expect(latsPath?.getAttribute('style')).toContain('fill: rgb(249, 115, 22)');
    });

    test('useHomeView retains recent muscle exposure for composed sets', () => {
      const now = Date.now();
      const mockLibrary = [
        {
          id: 'ex_bench',
          name: 'Panca Piana',
          setsCount: 3,
          sets: [],
          muscles: ['chest_lower', 'chest_upper'],
          secondaryMuscles: ['triceps', 'delts_front']
        },
        {
          id: 'ex_curl',
          name: 'Curl Bicipiti',
          setsCount: 3,
          sets: [],
          muscles: ['biceps'],
          secondaryMuscles: ['forearms']
        }
      ];

      // Workout done 24 hours ago (yesterday)
      const yesterdayWorkout = {
        id: 'w_yesterday',
        date: Logic.getLocalDateString(new Date(now - 24 * 3600 * 1000)),
        globalStartTime: now - (24 * 3600 * 1000),
        exercises: [
          {
            exId: 'ex_bench',
            sets: [
              { id: 's1', kg: '80', reps: '10' },
              { id: 's2', kg: '80', reps: '10' },
              { 
                id: 's3', 
                kg: '80', 
                reps: '8', 
                segments: [
                    { technique: 'dropset' as const, id: 'ds1', kg: '60', reps: '6' },
                  { technique: 'dropset' as const, id: 'ds2', kg: '40', reps: '6' }
                ] 
              }
            ]
          }
        ]
      };

      // Test component consuming useHomeView
      let hookResult: any = null;
      function TestHomeComponent() {
        const res = useHomeView();
        React.useEffect(() => { hookResult = res; });
        return <div data-testid="home-loaded">{res.loading ? 'loading' : 'ready'}</div>;
      }

      renderWithProviders(<TestHomeComponent />, {
        userData: {
          ...emptyUserData,
          library: mockLibrary,
          history: [yesterdayWorkout]
        } as any
      });

      expect(hookResult.loading).toBe(false);
      
      // Composed sets still count as factual exposure for the 72-hour recovery map.
      expect(hookResult.muscleColors['chest-lower-left']).toBe('var(--muscle-recent)');
      expect(hookResult.muscleColors['chest_lower']).toBe('var(--muscle-recent)');
    });

    test('useHomeView correctly exposes estimated BF from recent nutrition measurements', () => {
      let hookResult: any = null;
      function TestHomeComponent() {
        const res = useHomeView();
        React.useEffect(() => { hookResult = res; });
        return <div data-testid="home-loaded">{res.loading ? 'loading' : 'ready'}</div>;
      }

      renderWithProviders(<TestHomeComponent />, {
        userData: {
          ...emptyUserData,
          profile: { height: '180', gender: 'M', dob: '1995-05-10' },
          nutrition: {
            '2026-08-05': {
              date: '2026-08-05',
              weight: 80.5,
              waist: 84,
              neck: 39,
              bf: 15.2,
              kcal: 2200, carbs: 250, pro: 160, fat: 60
            }
          }
        } as any
      });

      expect(hookResult.loading).toBe(false);
      expect(hookResult.bf).toBe('15.2');
    });

    test('useHomeView generates proper chartData and periods (7d, 30d, 180d, 365d) without coupling hook data to chart colors', () => {
      let hookResult: any = null;
      function TestHomeComponent() {
        const res = useHomeView();
        React.useEffect(() => { hookResult = res; });
        return <div data-testid="home-loaded">{res.loading ? 'loading' : 'ready'}</div>;
      }

      renderWithProviders(<TestHomeComponent />, {
        userData: {
          ...emptyUserData,
          nutrition: {
            '2026-08-01': { date: '2026-08-01', weight: 81.0 },
            '2026-08-07': { date: '2026-08-07', weight: 79.8 }
          }
        } as any
      });

      expect(hookResult.loading).toBe(false);
      expect(hookResult.weightPeriod).toBe('7d');
      expect(hookResult.chartData.datasets[0].pointBackgroundColor).toBeUndefined();
      expect(hookResult.chartData.datasets[0].fill).toBeUndefined();
      expect(hookResult.chartData.labels.length).toBe(7);

      // Change period to 30d
      act(() => {
        hookResult.setWeightPeriod('30d');
      });
      expect(hookResult.weightPeriod).toBe('30d');
      expect(hookResult.chartData.labels.length).toBe(30);

      // Change period to 180d
      act(() => {
        hookResult.setWeightPeriod('180d');
      });
      expect(hookResult.weightPeriod).toBe('180d');
      expect(hookResult.chartData.labels.length).toBe(180);

      // Change period to 365d
      act(() => {
        hookResult.setWeightPeriod('365d');
      });
      expect(hookResult.weightPeriod).toBe('365d');
      expect(hookResult.chartData.labels.length).toBe(365);
    });
  });
});
