import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sealCloudDocument } from '../src/lib/sync/cloudDocumentCipher';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL } from '../src/lib/schemaEvolution';

describe('Firestore Security Rules Whitelist & Parity Verification', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

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

  it('allows only an active owner to access private month and telemetry collections', () => {
    expect(rulesContent).toMatch(/match\s+\/history_months\/\{monthId\}/);
    expect(rulesContent).toMatch(/allow\s+read:\s*if\s+isWritableOwner\(userId\);/);
    expect(rulesContent.match(/allow\s+delete:\s*if\s+false;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(rulesContent).toMatch(/match\s+\/nutrition_months\/\{monthId\}/);
    expect(rulesContent).toMatch(/match\s+\/telemetry_anomalies\/\{eventId\}/);
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

  it('users/{userId} whitelist contains all root UserData payload keys plus sync/schema metadata', () => {
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

  it('telemetry_anomalies whitelist contains all privacy-minimized payload keys', () => {
    const anomalyMatch = rulesContent.match(/match\s+\/telemetry_anomalies\/\{eventId\}[\s\S]*?isValidTelemetryAnomaly\(incomingData\(\)\)/);
    expect(anomalyMatch).not.toBeNull();
    expect(rulesContent).toContain("docData.type == 'storage_recovery_anomaly'");
    expect(rulesContent).toContain("docData.platform == 'ios'");
    expect(rulesContent).toContain('docData.standalone is bool');
    expect(rulesContent).toContain('docData.persisted == null || docData.persisted is bool');
  });

  it('requires the current bounded telemetry error/event Rules blocks', () => {
    expect(rulesContent).toMatch(/match\s+\/telemetry_errors\/\{errorId\}/);
    expect(rulesContent).toContain('function isValidTelemetryError(docData, userId)');
    expect(rulesContent).toContain('isValidTelemetryError(incomingData(), userId)');
    expect(rulesContent).toContain('preservesTelemetryErrorIdentity()');

    expect(rulesContent).toMatch(/match\s+\/telemetry_events\/\{eventId\}/);
    expect(rulesContent).toContain('function isValidTelemetryEvent(docData, userId)');
    expect(rulesContent).toContain('isValidTelemetryEvent(incomingData(), userId)');
    expect(rulesContent).toContain('isIdenticalTelemetryRetryOrExpiryUpgrade()');
  });

  it('bounds telemetry types, context, details and mutable fields', () => {
    expect(rulesContent).toContain('function isValidTelemetryContext(context)');
    expect(rulesContent).toContain('function isValidTelemetryDetails(details)');
    expect(rulesContent).toContain('function isValidTelemetryExpiry(docData)');
    expect(rulesContent).toContain("'expireAt' in docData");
    expect(rulesContent).toContain("docData.expireAt is timestamp");
    expect(rulesContent).toContain("request.time + duration.value(31, 'd')");
    expect(rulesContent).toContain('details.size() <= 12');
    expect(rulesContent).toContain("details.keys().hasOnly([");
    expect(rulesContent).toContain("isStringAtMost(docData.message, 4096)");
    expect(rulesContent).toContain("isStringAtMost(docData.stack, 1000)");
    expect(rulesContent).toContain('docData.count <= 1000000');
    expect(rulesContent).toContain('incomingData().count >= resource.data.count');
    expect(rulesContent).toContain('incomingData().lastSeen >= resource.data.lastSeen');
    expect(rulesContent).toContain('preservesTelemetryExpiry()');
    expect(rulesContent).toContain("affectedKeys().hasOnly(['expireAt'])");
  });
});
