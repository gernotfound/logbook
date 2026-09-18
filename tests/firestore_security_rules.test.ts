import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { UserData } from '../src/types';
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
    expect(rulesContent).toContain('return isOwner(userId) && !deletionJobExists(userId);');
    expect(rulesContent).toMatch(/match\s+\/account_deletions\/\{userId\}\s*\{[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/);
    expect(rulesContent.match(/isActiveOwner\(userId\)/g)?.length).toBeGreaterThanOrEqual(12);
  });

  it('keeps root deletion server-only while allowing active-owner reads and writes', () => {
    const usersBlock = rulesContent.match(/match\s+\/users\/\{userId\}\s*\{([\s\S]*?)\n\s*match\s+\/history_months/);
    expect(usersBlock).not.toBeNull();
    expect(usersBlock![1]).toMatch(/allow\s+read:\s*if\s+isActiveOwner\(userId\);/);
    expect(usersBlock![1]).toMatch(/allow\s+create,\s*update:\s*if\s+isActiveOwner\(userId\)/);
    expect(usersBlock![1]).not.toMatch(/allow\s+read,\s*delete:/);
    expect(usersBlock![1]).not.toMatch(/allow\s+delete:/);
  });

  it('allows only an active owner to access private month and telemetry collections', () => {
    expect(rulesContent).toMatch(/match\s+\/history_months\/\{monthId\}/);
    expect(rulesContent).toMatch(/allow\s+read,\s*delete:\s*if\s+isActiveOwner\(userId\);/);
    expect(rulesContent).toMatch(/match\s+\/nutrition_months\/\{monthId\}/);
    expect(rulesContent).toMatch(/match\s+\/telemetry_anomalies\/\{eventId\}/);
  });

  it('keeps Firestore data/sync rules aligned with current version constants and forbids marker downgrade', () => {
    expect(rulesContent).toContain("function isValidDataSchema(docData)");
    expect(rulesContent).toContain(`!('_schemaVersion' in docData) || docData._schemaVersion == ${CURRENT_DATA_SCHEMA}`);
    expect(rulesContent).toContain(`docData._sync.protocolVersion == ${CURRENT_SYNC_PROTOCOL}`);
    expect(rulesContent).toContain("docData._sync.keys().hasOnly(['protocolVersion', 'clock', 'fields'])");
    expect(rulesContent).toContain('docData._sync.clock is map');
    expect(rulesContent).toContain('docData._sync.fields is map');
    expect(rulesContent).toContain('function preservesDataSchema()');
    expect(rulesContent).toContain("!('_schemaVersion' in resource.data)");
    expect(rulesContent).toContain("'_schemaVersion' in incomingData()");
    expect(rulesContent.match(/isValidDataSchema\(incomingData\(\)\)/g)?.length).toBe(3);
    expect(rulesContent.match(/preservesDataSchema\(\)/g)?.length).toBe(4);
  });

  it('users/{userId} whitelist contains all root UserData payload keys plus sync/schema metadata', () => {
    const hasOnlyMatch = rulesContent.match(/incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
    expect(hasOnlyMatch).not.toBeNull();

    const extractedKeys = hasOnlyMatch![1]
      .split(',')
      .map(k => k.replace(/['"\s]/g, ''))
      .filter(Boolean);

    const expectedRootKeys: Array<keyof Omit<UserData, 'history' | 'nutrition'> | '_schemaVersion' | '_sync'> = [
      'profile', 'library', 'routines', 'customFoods', 'activeWorkout', 'trainingCycles', 'activeCycleId',
      'nutritionPlanning', 'supplements', 'activePains', 'catalogOverrides', 'legalConsent',
      'nutritionPlanningOrigin', '_schemaVersion', '_sync'
    ];

    expect(extractedKeys).toEqual(expect.arrayContaining(expectedRootKeys));
    expect(extractedKeys.length).toBe(expectedRootKeys.length);
  });

  it('simulates security rules whitelist evaluation on valid userDocData', () => {
    const hasOnlyMatch = rulesContent.match(/incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
    const allowedKeys = new Set(
      hasOnlyMatch![1]
        .split(',')
        .map(k => k.replace(/['"\s]/g, ''))
        .filter(Boolean)
    );

    const sampleUserDocData = {
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
      _schemaVersion: CURRENT_DATA_SCHEMA,
    };

    const payloadKeys = Object.keys(sampleUserDocData);
    expect(payloadKeys.every(k => allowedKeys.has(k))).toBe(true);
    expect([...payloadKeys, 'unauthorizedField'].every(k => allowedKeys.has(k))).toBe(false);
  });

  it('telemetry_anomalies whitelist contains all privacy-minimized payload keys', () => {
    const anomalyMatch = rulesContent.match(/match\s+\/telemetry_anomalies\/\{eventId\}[\s\S]*?incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
    expect(anomalyMatch).not.toBeNull();
    const extractedKeys = anomalyMatch![1].split(',').map(k => k.replace(/['"\s]/g, '')).filter(Boolean);
    const expectedKeys = ['type', 'reason', 'timestamp', 'elapsedMs', 'platform', 'standalone', 'persisted'];
    expect(extractedKeys).toEqual(expect.arrayContaining(expectedKeys));
    expect(extractedKeys.length).toBe(expectedKeys.length);
  });

  it('telemetry_errors and telemetry_events whitelist verification when configured in rules', () => {
    if (rulesContent.includes('telemetry_errors')) {
      expect(rulesContent).toMatch(/match\s+\/telemetry_errors\/\{errorId\}/);
      const errorMatch = rulesContent.match(/match\s+\/telemetry_errors\/\{errorId\}[\s\S]*?incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
      expect(errorMatch).not.toBeNull();
      const rawErrorKeys = errorMatch![1].split(',').map(k => k.replace(/['"\s]/g, '')).filter(Boolean);
      expect(rawErrorKeys).toEqual(expect.arrayContaining(['timestamp', 'type', 'message', 'stack', 'context', 'userId', 'sessionId', 'count', 'firstSeen', 'lastSeen']));
    }
    if (rulesContent.includes('telemetry_events')) {
      expect(rulesContent).toMatch(/match\s+\/telemetry_events\/\{eventId\}/);
      const eventMatch = rulesContent.match(/match\s+\/telemetry_events\/\{eventId\}[\s\S]*?incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
      expect(eventMatch).not.toBeNull();
      const rawEventKeys = eventMatch![1].split(',').map(k => k.replace(/['"\s]/g, '')).filter(Boolean);
      expect(rawEventKeys).toEqual(expect.arrayContaining(['timestamp', 'type', 'context', 'userId', 'sessionId']));
    }
  });
});
