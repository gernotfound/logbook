import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sealCloudDocument } from '../../src/lib/sync/cloudDocumentCipher';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../../src/lib/schemaEvolution';

describe('Firestore Security Rules Whitelist & Parity Verification', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');


  it('keeps the Firestore emulator suites on one isolated demo project', () => {
    const emulator = JSON.parse(fs.readFileSync('firebase.emulator.json', 'utf8'));
    expect(emulator.firestore.rules).toBe('firestore.rules');
    expect(emulator.emulators).toMatchObject({
      firestore: { host: '127.0.0.1', port: 8080 },
      singleProjectMode: true,
    });

    const runner = fs.readFileSync('scripts/run-firestore-rules-tests.mjs', 'utf8');
    const projectId = runner.match(/const PROJECT_ID = '([^']+)'/)?.[1];
    expect(projectId).toBe('demo-logbook-audit');
    const suites = fs.readdirSync('tests/emulator').filter(name => name.endsWith('.test.ts'));
    expect(suites.length).toBeGreaterThan(0);
    for (const suite of suites) {
      const source = fs.readFileSync(path.join('tests/emulator', suite), 'utf8');
      if (!source.includes('initializeTestEnvironment(')) continue;
      const projectIds = [...source.matchAll(/projectId:\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
      expect(projectIds, suite).toEqual([projectId]);
    }
  });

  it('rules file exists and specifies rules_version = 2', () => {
    expect(fs.existsSync(rulesPath)).toBe(true);
    expect(rulesContent).toContain("rules_version = '2'");
    expect(rulesContent).toContain('service cloud.firestore');
  });

  it('contains global_catalog public read rule', () => {
    expect(rulesContent).toMatch(/match\s+\/global_catalog\/\{document=\*\*\}/);
    expect(rulesContent).toMatch(/allow\s+read:\s*if\s+true;/);
  });

  it('makes account_deletions server-only and uses it as a cross-device access barrier', () => {
    expect(rulesContent).toContain('function deletionJobExists(userId)');
    expect(rulesContent).toContain('documents/account_deletions/$(userId)');
    expect(rulesContent).toContain('function isActiveOwner(userId)');
    expect(rulesContent).toMatch(/return isOwner\(userId\)\s*&& request\.auth\.token\.email_verified == true\s*&& !deletionJobExists\(userId\)\s*&& hasCurrentSession\(userId\);/);
    expect(rulesContent).toMatch(/match\s+\/session_revocations\/\{userId\}\s*\{[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/);
    expect(rulesContent).toMatch(/request\.auth\.token\.auth_time > get\(record\)\.data\.revokedAfterSeconds/);
    expect(rulesContent).toMatch(/match\s+\/account_deletions\/\{userId\}\s*\{[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/);
    expect(rulesContent).toMatch(/match\s+\/user_data_keys\/\{userId\}\s*\{[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/);
    expect(rulesContent).toContain('function isWritableOwner(userId)');
    expect(rulesContent).toContain('function consentWithdrawn(userId)');
    expect(rulesContent).toContain('function matchesConsentEpoch(userId, candidate)');
    expect(rulesContent).toContain('match /health_consent_withdrawals/{userId} {');
    expect(rulesContent.match(/isWritableOwner\(userId\)/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it('keeps root deletion server-only while allowing active-owner reads and writes', () => {
    const usersBlock = rulesContent.match(/match\s+\/users\/\{userId\}\s*\{([\s\S]*?)\n\s*match\s+\/history_months/);
    expect(usersBlock).not.toBeNull();
    expect(usersBlock![1]).toMatch(/allow\s+read:\s*if\s+isWritableOwner\(userId\);/);
    expect(usersBlock![1]).toMatch(/allow\s+create,\s*update:\s*if\s+isWritableOwner\(userId\)/);
    expect(usersBlock![1]).not.toMatch(/allow\s+read,\s*delete:/);
    expect(usersBlock![1]).not.toMatch(/allow\s+delete:/);
  });

  it('allows only an active owner to access private month collections', () => {
    expect(rulesContent).toMatch(/match\s+\/history_months\/\{monthId\}/);
    expect(rulesContent).toMatch(/allow\s+read:\s*if\s+isWritableOwner\(userId\);/);
    expect(rulesContent.match(/allow\s+delete:\s*if\s+false;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(rulesContent).toMatch(/match\s+\/nutrition_months\/\{monthId\}/);
  });

  it('keeps Firestore data/sync rules aligned with current version constants and forbids marker downgrade', () => {
    expect(rulesContent).toContain("function isValidDataSchema(docData)");
    expect(rulesContent).toContain(`'_schemaVersion' in docData && docData._schemaVersion == ${CURRENT_DATA_SCHEMA}`);
    expect(CURRENT_SYNC_PROTOCOL).toBe(3);
    expect(rulesContent).not.toContain("docData._sync.protocolVersion == 1 || docData._sync.protocolVersion == 2");
    expect(rulesContent).toContain("docData._sync.protocolVersion == 3");
    expect(rulesContent).toContain("docData._sync.keys().hasOnly(['protocolVersion', 'clock', 'fields', 'writer'])");
    expect(rulesContent).toContain('function hasProtocol3Writer(userId, docData)');
    expect(rulesContent).toContain("return '_sync' in docData && hasProtocol3Writer(userId, docData);");
    expect(rulesContent).toContain('function validReplicaControlUpdate(userId, oldData, newData)');
    expect(rulesContent).toContain("match /sync_control/{controlId}");
    expect(rulesContent).toContain('docData._sync.clock is map');
    expect(rulesContent).toContain('docData._sync.fields is map');
    expect(rulesContent).toContain('function preservesDataSchema()');
    expect(rulesContent).toContain('function preservesSyncProtocol()');
    expect(rulesContent).toContain('incomingData()._sync.protocolVersion >= resource.data._sync.protocolVersion');
    expect(rulesContent).toContain("'_schemaVersion' in resource.data");
    expect(rulesContent).toContain("incomingData()._schemaVersion >= resource.data._schemaVersion");
    expect(rulesContent.match(/isValidDataSchema\(incomingData\(\)\)/g)?.length).toBe(3);
    expect(rulesContent.match(/preservesDataSchema\(\)/g)?.length).toBe(4);
    expect(rulesContent.match(/preservesSyncProtocol\(\)/g)?.length).toBe(4);
  });

  it('allows only schema, sync and sealed ciphertext fields on cloud document envelopes', () => {
    const hasOnlyMatch = rulesContent.match(/function isSealedCloudDocument\(data\)[\s\S]*?data\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
    expect(hasOnlyMatch).not.toBeNull();

    const extractedKeys = hasOnlyMatch![1]
      .split(',')
      .map(k => k.replace(/['"\s]/g, ''))
      .filter(Boolean);

    const expectedRootKeys = ['_schemaVersion', '_sync', '_sealed'];

    expect(extractedKeys).toEqual(expect.arrayContaining(expectedRootKeys));
    expect(extractedKeys.length).toBe(expectedRootKeys.length);
  });

  it('checks sample root payload keys against the static Rules whitelist (not authorization)', () => {
    const hasOnlyMatch = rulesContent.match(/function isSealedCloudDocument\(data\)[\s\S]*?data\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
    const allowedKeys = new Set(
      hasOnlyMatch![1]
        .split(',')
        .map(k => k.replace(/['"\s]/g, ''))
        .filter(Boolean)
    );

    const sampleBusiness = {
      profile: { name: 'Test User' },
      library: [{ id: 'ex1', name: 'Panca Piana' }],
      routines: [{ id: 'r1', name: 'Upper' }],
      customFoods: [{ id: 'cf1', name: 'Whey' }],
      activeWorkout: null,
      trainingCycles: [],
      activeCycleId: null,
      nutritionPlanning: null,
      supplements: [],
      activePains: [],
      catalogOverrides: { exercises: {}, hiddenExerciseIds: ['ex_old'], foods: {}, hiddenFoodIds: [] },
    };
    const sampleUserDocData = sealCloudDocument(new Uint8Array(32).fill(18), 'test-user-id', '', sampleBusiness, {
      protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {},
      writer: { slot: 's00', replicaId: 'rules-static-fixture', generation: 1, seq: 0 },
    });
    const payloadKeys = Object.keys(sampleUserDocData);
    expect(payloadKeys).not.toContain('profile');
    expect(payloadKeys).not.toContain('library');
    expect(payloadKeys.every(k => allowedKeys.has(k))).toBe(true);
    expect([...payloadKeys, 'unauthorizedField'].every(k => allowedKeys.has(k))).toBe(false);
  });


});
