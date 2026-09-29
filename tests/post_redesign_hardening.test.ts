import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const listTsxFiles = (dir: string): string[] => readdirSync(resolve(dir), { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return listTsxFiles(path);
  return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
});

const adaptiveSurfaceFiles = [
  'src/components/Data/DataMeasurements.tsx',
  'src/components/Data/DataSleep.tsx',
  'src/components/ExportSelector.tsx',
  'src/components/Nutrition/NutritionSupplements.tsx',
  'src/components/Training/ActiveWorkoutSession.tsx',
  'src/components/Training/ExerciseSearchDropdown.tsx',
  'src/components/Training/exercises/ExerciseEditorForm.tsx',
  'src/components/Training/planning/CycleEditor.tsx',
  'src/components/Training/planning/TrainingPlanning.tsx',
  'src/components/Training/routines/RoutineExerciseItem.tsx',
  'src/components/Training/session/SessionExerciseCard.tsx',
  'src/components/Training/session/SessionRatings.tsx',
  'src/components/Training/WorkoutReportModal.tsx',
];

describe('post-redesign UI hardening', () => {
  it('keeps the exercise proposal compact and iOS-safe on mobile', () => {
    const training = read('src/components/Training/training.css');
    const routines = read('src/components/Training/routines/routines.css');
    expect(training).toMatch(/\.exercise-library-header h2\s*\{[^}]*flex:\s*1 1 auto[^}]*white-space:\s*nowrap/);
    expect(training).toMatch(/\.exercise-create-button\s*\{[^}]*width:\s*auto[^}]*max-width:\s*none[^}]*flex:\s*0 0 auto[^}]*white-space:\s*nowrap/);
    const exerciseCreate = training.match(/\.exercise-create-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const routineCreate = routines.match(/\.routine-create-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const declarations = (block: string) => block.split(';').map(value => value.trim()).filter(Boolean).sort();
    expect(declarations(routineCreate)).toEqual(declarations(exerciseCreate));
    expect(training).toMatch(/\.training-sub-view\.active\.exercise-library\s*\{[^}]*display:\s*grid/);
    expect(training).toMatch(/\.exercise-editor-close\s*\{[^}]*width:\s*auto[^}]*min-height:\s*2\.75rem/);
    expect(training).toMatch(/\.exercise-search-wrap > \.exercise-search-input,[\s\S]*?\.exercise-muscle-search-wrap > \.exercise-muscle-search-input\s*\{[^}]*margin:\s*0[^}]*padding:\s*\.625rem 2\.75rem \.625rem 2\.875rem/);
    expect(training).toMatch(/#view-training > \.sub-nav-shell \.sub-nav-btn\s*\{[^}]*font-size:\s*var\(--font-size-meta\)/);
    expect(training).toMatch(/#view-training > \.sub-nav-shell \.sub-nav-edge\s*\{[^}]*display:\s*none/);
  });

  it('keeps Schede grid spacing active instead of being overridden by the generic sub-view rule', () => {
    const routines = read('src/components/Training/routines/routines.css');
    expect(routines).toMatch(/\.training-sub-view\.active\.training-routines-page\s*\{[^}]*display:\s*grid[^}]*gap:\s*\.75rem/);
  });

  it('keeps consistent grid spacing throughout the history page', () => {
    const training = read('src/components/Training/training.css');
    expect(training).toMatch(/\.training-sub-view\.active\.training-history\s*\{[^}]*display:\s*grid[^}]*gap:\s*\.75rem/);
    expect(training).toMatch(/\.history-header\s*\{[^}]*margin-bottom:\s*0/);
  });

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

  it('keeps the routine editor actions flush with the form bottom', () => {
    const routineEditor = read('src/components/Training/routines/RoutineEditor.tsx');
    expect(routineEditor).toMatch(/return\s*\(\s*<div>\s*<div className="routine-editor-head">/);
    expect(routineEditor).not.toMatch(/return\s*\(\s*<div className="section-divider">/);
  });

  it('keeps Schede and Esercizi creation actions aligned', () => {
    const routineEditor = read('src/components/Training/routines/RoutineEditor.tsx');
    const exerciseEditor = read('src/components/Training/exercises/ExerciseEditorForm.tsx');
    const routines = read('src/components/Training/routines/routines.css');

    expect(routineEditor).toContain('className="btn routine-editor-close"');
    expect(routineEditor).toMatch(/>\s*Chiudi\s*<\/button>/);
    expect(routineEditor).toMatch(/editingRoutineId \? <><Save[^\n]+Salva modifiche<\/> : 'Salva'/);
    expect(exerciseEditor).not.toMatch(/<Save\s/);
    expect(exerciseEditor).toContain("{isSaving ? 'Salvataggio…' : 'Salva'}");
    expect(routines).toMatch(/\.routine-editor-close\s*\{[^}]*min-height:\s*2\.75rem[^}]*padding:\s*0 \.875rem/);
  });

  it('keeps compact interactive controls at the 44px minimum target', () => {
    const routineItem = read('src/components/Training/routines/RoutineExerciseItem.tsx');
    const training = read('src/components/Training/training.css');
    expect(routineItem).not.toContain("height: '42px'");
    expect(routineItem).not.toContain("minHeight: '42px'");
    expect(training).toMatch(/\.exercise-muscle-tag\s*\{[^}]*min-height:\s*2\.75rem/);
  });

  it('keeps exercise search and session callouts theme-semantic', () => {
    const search = read('src/components/Training/ExerciseSearchDropdown.tsx');
    const setCard = read('src/components/Training/session/SessionExerciseCard.tsx');
    const ratings = read('src/components/Training/session/SessionRatings.tsx');
    expect(search).toContain("color: isHighlighted ? 'var(--on-primary)' : 'var(--text-main)'");
    expect(search).not.toMatch(/rgba\((?:255\s*,\s*255\s*,\s*255|46\s*,\s*204\s*,\s*113|255\s*,\s*183\s*,\s*3|0\s*,\s*229\s*,\s*255)/);
    expect(search).not.toContain('#000000');
    expect(setCard).toContain("background: 'var(--danger-soft)'");
    expect(setCard).not.toContain('#fca5a5');
    expect(ratings).not.toMatch(/background:\s*pains\.length[^\n]*rgba\(255\s*,\s*255\s*,\s*255/);
  });

  it('keeps state surfaces on semantic theme tokens', () => {
    const paths = [
      'src/components/Settings/AccountSettingsTab.tsx',
      'src/components/Nutrition/InlineEditMealItem.tsx',
      'src/components/Training/TrainingSessionSetup.tsx',
      'src/components/Training/planning/CycleCard.tsx',
      'src/components/Training/planning/CycleEditor.tsx',
      'src/components/Training/planning/CycleRoutinesList.tsx',
      'src/components/Training/planning/CycleSchedulePreview.tsx',
      'src/components/Training/session/SessionExerciseCard.tsx',
      'src/components/Training/session/SessionRatings.tsx',
      'src/pages/TermsAndConditions.tsx',
    ];
    for (const path of paths) {
      const source = read(path);
      expect(source, path).not.toMatch(/rgba\((?:14\s*,\s*165\s*,\s*233|0\s*,\s*229\s*,\s*255|239\s*,\s*68\s*,\s*68|255\s*,\s*77\s*,\s*109)/);
    }

    const muscleModel = read('src/components/Training/MuscleModel.tsx');
    expect(muscleModel).not.toMatch(/var\(--(?:surface-color|surface-light|text-main|text-muted|primary-color|glass-border),/);
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
    expect(routineItem).not.toContain("helpButton('setTechnique')");
    expect(routineItem).not.toContain('Queste impostazioni valgono solo per questo utilizzo dell’esercizio in questa scheda.');
    expect(routineItem).toContain("fieldHeader('Esecuzione da mantenere', 'technicalStandard'");
    expect(routineItem).toContain("fieldHeader('Ruolo nella scheda', 'role'");
    expect(routineItem).toContain("fieldHeader('Cosa vuoi migliorare', 'metric'");
    expect(routineItem).not.toContain('Tecnica per serie:');
    expect(routineItem).toContain('disclosure-summary technique-summary');
    expect(routineItem).not.toContain('Riferimento storico (avanzato)');
    expect(routineItem).not.toContain('Regola di successo');
    expect(routineItem).not.toContain('Regola di cambio');
    expect(routineItem).not.toContain('Prossima azione');
  });

  it('gives every native disclosure an explicit button affordance', () => {
    const disclosureFiles = listTsxFiles('src/components').filter(path => read(path).includes('<summary'));
    expect(disclosureFiles.length).toBeGreaterThan(0);

    for (const path of disclosureFiles) {
      const source = read(path);
      const summaries = [...source.matchAll(/<summary([^>]*)>/g)];
      for (const summary of summaries) {
        expect(summary[1], `${path}: ${summary[0]}`).toContain('disclosure-summary');
      }
    }

    const components = read('src/styles/components.css');
    expect(components).toMatch(/\.disclosure-summary\s*\{[^}]*min-height:\s*2\.75rem[^}]*border:\s*1px solid var\(--glass-border\)[^}]*background:\s*var\(--surface-light\)/s);
    expect(components).toContain('.disclosure-summary:focus-visible');
    expect(components).toContain('details[open] > .disclosure-summary');
    expect(components).toMatch(/\.technique-summary::after\s*\{[^}]*content:\s*'\+'/s);
    expect(components).toMatch(/details\[open\] > \.technique-summary::after\s*\{[^}]*content:\s*'-'/s);
  });

});
