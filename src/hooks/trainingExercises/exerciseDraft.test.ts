import { beforeEach, describe, expect, it } from 'vitest';
import { deviceKey } from '../../lib/sync/deviceStorage';
import {
  clearExerciseDraft,
  persistExerciseDraft,
  readExerciseDraft,
  type ExerciseDraft,
} from './exerciseDraft';

const draft: ExerciseDraft = {
  name: 'Panca privata',
  notes: 'Nota account A',
  trackingType: 'weight_reps',
  selectedMuscles: [],
  secondaryMuscles: [],
  isBodyweight: false,
  equipmentWeight: '20',
};

describe('exercise draft owner isolation', () => {
  beforeEach(() => localStorage.clear());

  it('keeps drafts isolated between owners and never writes the legacy global key', () => {
    persistExerciseDraft(draft, 'user:a');

    expect(readExerciseDraft('user:a')?.name).toBe('Panca privata');
    expect(readExerciseDraft('user:b')).toBeNull();
    expect(localStorage.getItem(deviceKey('draft_exercise', 'user:a'))).not.toBeNull();
    expect(localStorage.getItem('draft_exercise')).toBeNull();

    clearExerciseDraft('user:a');
    expect(readExerciseDraft('user:a')).toBeNull();
  });
  it('preserves a legacy exercise draft instead of promoting it after consent erasure', () => {
    const owner = 'user:a';
    const key = deviceKey('draft_exercise', owner);
    const raw = JSON.stringify(draft);
    localStorage.setItem(key, raw);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    expect(() => readExerciseDraft(owner)).toThrow('generazione di consenso');
    expect(() => persistExerciseDraft({ ...draft, notes: 'Changed' }, owner)).toThrow('generazione di consenso');
    expect(() => clearExerciseDraft(owner)).toThrow('generazione di consenso');
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it('stamps new exercise drafts and fences prior authenticated generations', () => {
    const owner = 'user:a';
    const name = 'draft_exercise';
    const key = deviceKey(name, owner);
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    localStorage.setItem(marker, '3');
    persistExerciseDraft(draft, owner);
    const raw = localStorage.getItem(key);
    expect(JSON.parse(raw!)).toMatchObject({
      __logbookWorkoutRecoveryDraft: 1, owner, name, consentRevision: 3,
      data: { name: 'Panca privata' },
    });
    localStorage.setItem(marker, '5');
    expect(() => readExerciseDraft(owner)).toThrow('generazione di consenso');
    expect(() => clearExerciseDraft(owner)).toThrow('generazione di consenso');
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it('blocks invalid provenance metadata without clearing the original', () => {
    const owner = 'user:a';
    const name = 'draft_exercise';
    const key = deviceKey(name, owner);
    const raw = JSON.stringify({
      __logbookWorkoutRecoveryDraft: 1, owner: 'user:b',
      name, consentRevision: 3, data: draft,
    });
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    localStorage.setItem(key, raw);
    expect(() => readExerciseDraft(owner)).toThrow('Metadati');
    expect(() => persistExerciseDraft(draft, owner)).toThrow('Metadati');
    expect(localStorage.getItem(key)).toBe(raw);
  });

});
