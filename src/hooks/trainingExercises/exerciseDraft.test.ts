import { beforeEach, describe, expect, it } from 'vitest';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../lib/sync/deviceStorage';
import { createAndMigrateVault } from '../../lib/sync/secureArchiveMigration';
import { prepareUnlockedTestArchive } from '../../../tests/secureVaultFixture';
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

  it('keeps sealed drafts isolated between unlocked owners and never writes a plaintext key', async () => {
    await prepareUnlockedTestArchive('user:a');
    await createAndMigrateVault('user:b');
    const otherDraft = { ...draft, name: 'Scheda account B' };
    persistExerciseDraft(draft, 'user:a');
    persistExerciseDraft(otherDraft, 'user:b');
    const keyA = protectedDeviceKey('draft_exercise', 'user:a');
    const keyB = protectedDeviceKey('draft_exercise', 'user:b');
    const otherCiphertext = localStorage.getItem(keyB);

    expect(readExerciseDraft('user:a')?.name).toBe('Panca privata');
    expect(readExerciseDraft('user:b')?.name).toBe('Scheda account B');
    expect(localStorage.getItem(keyA)).toMatch(/^tlb-sealed:v1:/);
    expect(otherCiphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey('draft_exercise', 'user:a'))).toBeNull();
    expect(localStorage.getItem(deviceKey('draft_exercise', 'user:b'))).toBeNull();
    expect(localStorage.getItem('draft_exercise')).toBeNull();

    clearExerciseDraft('user:a');
    expect(readExerciseDraft('user:a')).toBeNull();
    expect(localStorage.getItem(keyA)).toBeNull();
    expect(localStorage.getItem(keyB)).toBe(otherCiphertext);
    expect(readExerciseDraft('user:b')?.name).toBe('Scheda account B');
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

  it('stamps sealed exercise drafts and fences prior authenticated generations', async () => {
    const owner = 'user:a';
    const name = 'draft_exercise';
    const sealedKey = protectedDeviceKey(name, owner);
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    localStorage.setItem(marker, '3');
    await prepareUnlockedTestArchive(owner);
    persistExerciseDraft(draft, owner);
    const raw = readDeviceValueStrict(name, owner);
    const ciphertext = localStorage.getItem(sealedKey);
    expect(JSON.parse(raw!)).toMatchObject({
      __logbookWorkoutRecoveryDraft: 1, owner, name, consentRevision: 3,
      data: { name: 'Panca privata' },
    });
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    localStorage.setItem(marker, '5');
    expect(() => readExerciseDraft(owner)).toThrow('generazione di consenso');
    expect(() => clearExerciseDraft(owner)).toThrow('generazione di consenso');
    expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
    expect(readDeviceValueStrict(name, owner)).toBe(raw);
  });

  it('refuses to re-stamp mounted values under a later consent epoch but permits a new sealed draft', async () => {
    const owner = 'user:a';
    await prepareUnlockedTestArchive(owner);
    const marker = `logbook:v2:${owner}:health-consent-generation`;
    const sealedKey = protectedDeviceKey('draft_exercise', owner);
    // The form was mounted in revision 3 and had not yet written a draft.
    localStorage.setItem(marker, '5');
    expect(() => persistExerciseDraft(draft, owner, '3')).toThrow('Generazione consenso cambiata');
    expect(localStorage.getItem(sealedKey)).toBeNull();
    // A new current-revision form can still produce a valid copy.
    persistExerciseDraft(draft, owner, '5');
    expect(JSON.parse(readDeviceValueStrict('draft_exercise', owner)!)).toMatchObject({
      consentRevision: 5, owner, name: 'draft_exercise',
    });
    expect(localStorage.getItem(sealedKey)).toMatch(/^tlb-sealed:v1:/);
    expect(localStorage.getItem(deviceKey('draft_exercise', owner))).toBeNull();
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
