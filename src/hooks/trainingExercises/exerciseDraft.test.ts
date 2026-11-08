import { beforeEach, describe, expect, it } from 'vitest';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../lib/sync/deviceStorage';
import { createAndMigrateVault } from '../../lib/sync/secureArchiveMigration';
import { prepareUnlockedTestArchive } from '../../../tests/secureVaultFixture';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../lib/sync/session';
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
    localStorage.setItem('logbook:v2:user:a:health-consent-generation', '3');
    localStorage.setItem('logbook:v2:user:b:health-consent-generation', '3');
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
    expect(() => readExerciseDraft(owner)).toThrow('Archivio locale cifrato non valido');
    expect(() => persistExerciseDraft({ ...draft, notes: 'Changed' }, owner)).toThrow('Archivio locale cifrato non valido');
    expect(() => clearExerciseDraft(owner)).toThrow('Archivio locale cifrato non valido');
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it('rejects sealed unversioned account drafts even at the first consent revision, preserving the bytes', async () => {
    const owner = 'user:a';
    const name = 'draft_exercise';
    await prepareUnlockedTestArchive(owner);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
    writeDeviceValue(name, JSON.stringify(draft), owner);
    const sealedKey = protectedDeviceKey(name, owner);
    const ciphertext = localStorage.getItem(sealedKey);
    expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
    expect(() => readExerciseDraft(owner)).toThrow('senza provenienza');
    expect(() => persistExerciseDraft({ ...draft, name: 'Overwrite' }, owner)).toThrow('senza provenienza');
    expect(() => clearExerciseDraft(owner)).toThrow('senza provenienza');
    expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
    expect(JSON.parse(readDeviceValueStrict(name, owner)!)).toMatchObject(draft);
  });

  it.each([
    ['invalid tracking type', { ...draft, trackingType: 'invalid' }],
    ['invalid muscle list', { ...draft, selectedMuscles: 'not-an-array' }],
    ['invalid weight type', { ...draft, equipmentWeight: 5 }],
  ])('preserves malformed authenticated %s rather than rewriting its ciphertext', async (_reason, badDraft) => {
    const owner = 'user:a';
    await prepareUnlockedTestArchive(owner);
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    const { writeWorkoutRecoveryDraft } = await import('../../lib/sync/workoutRecoveryDraft');
    writeWorkoutRecoveryDraft('draft_exercise', owner, badDraft, '3');
    const key = protectedDeviceKey('draft_exercise', owner);
    const original = localStorage.getItem(key);
    expect(original).toMatch(/^tlb-sealed:v1:/);
    expect(() => readExerciseDraft(owner)).toThrow('Bozza esercizio non valida');
    expect(() => persistExerciseDraft(draft, owner, '3')).toThrow('Bozza esercizio non valida');
    expect(() => clearExerciseDraft(owner, '3')).toThrow('Bozza esercizio non valida');
    expect(localStorage.getItem(key)).toBe(original);
  });

  it('refuses unstamped new account drafts without a consent marker', async () => {
    const owner = 'user:a';
    await prepareUnlockedTestArchive(owner);
    expect(() => persistExerciseDraft(draft, owner)).toThrow('Generazione consenso');
    expect(readDeviceValueStrict('draft_exercise', owner)).toBeNull();
    expect(localStorage.getItem(protectedDeviceKey('draft_exercise', owner))).toBeNull();
  });

  it('keeps the current guest draft format readable in its own sealed vault', async () => {
    const owner = 'guest';
    const generation = 'test-guest-exercise-draft-session';
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, generation);
    activateGuestSession(generation);
    await prepareUnlockedTestArchive(owner);
    persistExerciseDraft(draft, owner);
    expect(readExerciseDraft(owner)).toMatchObject(draft);
    expect(readDeviceValueStrict('draft_exercise', owner)).toBe(JSON.stringify(draft));
    clearExerciseDraft(owner);
    expect(readExerciseDraft(owner)).toBeNull();
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

  it('blocks invalid provenance metadata without clearing the original', async () => {
    await prepareUnlockedTestArchive('user:a');
    const owner = 'user:a';
    const name = 'draft_exercise';
    const key = deviceKey(name, owner);
    const raw = JSON.stringify({
      __logbookWorkoutRecoveryDraft: 1, owner: 'user:b',
      name, consentRevision: 3, data: draft,
    });
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    const ciphertextKey = protectedDeviceKey(name, owner);
    writeDeviceValue(name, raw, owner);
    const originalCiphertext = localStorage.getItem(ciphertextKey);
    expect(() => readExerciseDraft(owner)).toThrow('Metadati');
    expect(() => persistExerciseDraft(draft, owner)).toThrow('Metadati');
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(ciphertextKey)).toBe(originalCiphertext);
  });

});
