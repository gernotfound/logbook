import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

const adaptiveSurfaceFiles = [
  'src/components/Data/DataMeasurements.tsx',
  'src/components/Data/DataSleep.tsx',
  'src/components/ExportSelector.tsx',
  'src/components/Nutrition/NutritionSupplements.tsx',
  'src/components/Training/ActiveWorkoutSession.tsx',
  'src/components/Training/exercises/ExerciseEditorForm.tsx',
  'src/components/Training/planning/CycleEditor.tsx',
  'src/components/Training/planning/TrainingPlanning.tsx',
  'src/components/Training/routines/RoutineExerciseItem.tsx',
  'src/components/Training/session/SessionExerciseCard.tsx',
  'src/components/Training/session/SessionRatings.tsx',
  'src/components/Training/WorkoutReportModal.tsx',
];

describe('post-redesign UI hardening', () => {
  it('does not render an automatic installation popup', () => {
    expect(existsSync(resolve('src/components/UI/InstallPrompt.tsx'))).toBe(false);
    expect(read('src/App.tsx')).not.toContain('InstallPrompt');
  });

  it('keeps critical adaptive surfaces free of dark-only background constants', () => {
    const darkOnlyBackground = /background:\s*['"]rgba\((?:255\s*,\s*255\s*,\s*255|0\s*,\s*0\s*,\s*0)/;
    for (const path of adaptiveSurfaceFiles) {
      expect(read(path), path).not.toMatch(darkOnlyBackground);
    }
  });

  it('keeps the guest account action readable on warning surfaces', () => {
    const components = read('src/styles/components.css');
    expect(components).toMatch(/\.guest-banner \.btn\s*\{[^}]*background:\s*var\(--warning-color\)[^}]*color:\s*var\(--on-warning\)/);
  });

  it('uses semantic danger and muscle-state colors instead of dark-theme red/orange literals', () => {
    for (const path of [
      'src/components/Training/session/SessionRatings.tsx',
      'src/components/Home/widgets/RecoveryBentoCard.tsx',
      'src/hooks/useHomeView.ts',
    ]) {
      expect(read(path), path).not.toMatch(/#(?:ff4d6d|ff6b81|ef4444|f97316)/i);
    }
    expect(read('src/hooks/useHomeView.ts')).toContain('var(--muscle-recent)');
    expect(read('src/hooks/useHomeView.ts')).toContain('var(--muscle-pain)');
  });
  it('keeps the cycle duration compact and muscle search results in document flow', () => {
    const components = read('src/styles/components.css');
    expect(components).toMatch(/\.cycle-duration-input\s*\{[^}]*width:\s*7\.5rem/);
    expect(components).toMatch(/\.muscle-priority-results\s*\{[^}]*position:\s*static/);
  });

  it('keeps routine editor fields explicitly named and theme-adaptive', () => {
    const routineItem = read('src/components/Training/routines/RoutineExerciseItem.tsx');
    expect(routineItem).toContain('htmlFor={setsId}');
    expect(routineItem).toContain('aria-label="Ripetizioni minime"');
    expect(routineItem).toContain('aria-label="Ripetizioni massime"');
    expect(routineItem).not.toMatch(/rgba\(255\s*,\s*255\s*,\s*255/);
    expect(routineItem).not.toContain('#00e5ff');
    expect(routineItem).toContain("background: 'var(--primary-soft)'");
    expect(routineItem).toContain('CircleHelp');
    expect(routineItem).toContain('Spiega:');
    expect(routineItem).toContain('Queste impostazioni valgono solo per questo utilizzo dell’esercizio in questa scheda.');
    expect(routineItem).toContain("fieldHeader('Esecuzione da mantenere', 'technicalStandard'");
    expect(routineItem).toContain("fieldHeader('Ruolo nella scheda', 'role'");
    expect(routineItem).toContain("fieldHeader('Cosa vuoi migliorare', 'metric'");
  });

});
