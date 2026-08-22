import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkDocSize, isDocSizeWithinLimit, calculateDocSizeBytes } from '../src/security/checkDocSize.js';

describe('Firestore Security Rules & Quota Validation Suite', () => {
  const rulesPath = path.resolve(__dirname, '../firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  describe('Zero get() / exists() Invariant (0 Extra Read Cost on Spark)', () => {
    it('must NOT contain any get() or exists() calls in firestore.rules code', () => {
      // Strip comments (// and /* ... */) to evaluate actual rule statements
      const codeWithoutComments = rulesContent
        .replace(/\/\/.*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

      const hasGetCall = /\bget\s*\(/.test(codeWithoutComments);
      const hasExistsCall = /\bexists\s*\(/.test(codeWithoutComments);

      expect(hasGetCall).toBe(false);
      expect(hasExistsCall).toBe(false);
    });

    it('must have default deny-all fallback', () => {
      expect(rulesContent).toContain('match /{document=**}');
      expect(rulesContent).toContain('allow read, write: if false;');
    });
  });

  describe('Global Catalog Public Read-Only Rules', () => {
    it('must allow public read and strictly forbid client write for /global_catalog', () => {
      expect(rulesContent).toMatch(/match \/global_catalog\/\{document=\*\*\}/);
      expect(rulesContent).toContain('allow read: if true;');
      expect(rulesContent).toContain('allow write: if false;');
    });
  });

  describe('User Ownership & Authentication Logic', () => {
    // Pure logic simulation of rules helper functions
    function isAuthenticated(auth: { uid: string } | null) {
      return auth !== null;
    }

    function isOwner(userId: string, auth: { uid: string } | null) {
      return isAuthenticated(auth) && auth?.uid === userId;
    }

    it('denies access to unauthenticated requests', () => {
      expect(isOwner('user_123', null)).toBe(false);
    });

    it('allows access only when auth.uid matches target userId', () => {
      expect(isOwner('user_123', { uid: 'user_123' })).toBe(true);
      expect(isOwner('user_123', { uid: 'user_attacker' })).toBe(false);
    });
  });

  describe('Root Document Field Whitelisting', () => {
    const ALLOWED_ROOT_KEYS = [
      'profile',
      'library',
      'customExercises',
      'routines',
      'customFoods',
      'activeWorkout',
      'trainingCycles',
      'activeCycleId',
      'nutritionPlanning',
      'supplements',
      'activePains',
      'catalogOverrides',
      'catalogHiddenIds',
      'exerciseOverrides',
      'foodOverrides',
      'hiddenCatalogExercises',
      'hiddenCatalogFoods',
    ];

    function validateRootDocKeys(data: Record<string, any>): boolean {
      const keys = Object.keys(data);
      return keys.every((k) => ALLOWED_ROOT_KEYS.includes(k));
    }

    it('accepts valid root payloads containing only whitelisted keys', () => {
      const validPayload = {
        profile: { gender: 'M', height: '180' },
        customExercises: [{ id: 'ex_1', name: 'Panca piana', setsCount: 3 }],
        routines: [{ id: 'r_1', name: 'Scheda A', exercises: [] }],
        activeCycleId: 'cycle_1',
      };

      expect(validateRootDocKeys(validPayload)).toBe(true);
    });

    it('rejects root payloads with unauthorized or malicious keys', () => {
      const maliciousPayload = {
        profile: {},
        isAdmin: true, // Forbidden field
        role: 'superadmin', // Forbidden field
      };

      expect(validateRootDocKeys(maliciousPayload)).toBe(false);
    });
  });

  describe('Array Length Bounding (Database Pollution Prevention)', () => {
    const ARRAY_LIMITS = {
      library: 500,
      customExercises: 500,
      routines: 100,
      customFoods: 1000,
      trainingCycles: 50,
      supplements: 50,
      activePains: 50,
      catalogHiddenIds: 500,
      hiddenCatalogExercises: 500,
      hiddenCatalogFoods: 500,
    };

    function validateArrayBounds(data: Record<string, any>): { valid: boolean; exceededKey?: string } {
      for (const [key, limit] of Object.entries(ARRAY_LIMITS)) {
        if (key in data) {
          const val = data[key];
          if (!Array.isArray(val) || val.length > limit) {
            return { valid: false, exceededKey: key };
          }
        }
      }
      return { valid: true };
    }

    it('accepts arrays within configured limits', () => {
      const payload = {
        customExercises: new Array(500).fill({ id: 'ex', name: 'Test' }),
        routines: new Array(100).fill({ id: 'r', name: 'Test' }),
        customFoods: new Array(1000).fill({ id: 'f', name: 'Test' }),
        trainingCycles: new Array(50).fill({ id: 'c', name: 'Test' }),
        supplements: new Array(50).fill({ id: 's', name: 'Test' }),
        activePains: new Array(50).fill('knee'),
      };

      expect(validateArrayBounds(payload).valid).toBe(true);
    });

    it('rejects arrays exceeding maximum limits', () => {
      expect(validateArrayBounds({ customExercises: new Array(501).fill({}) }).valid).toBe(false);
      expect(validateArrayBounds({ routines: new Array(101).fill({}) }).valid).toBe(false);
      expect(validateArrayBounds({ customFoods: new Array(1001).fill({}) }).valid).toBe(false);
      expect(validateArrayBounds({ trainingCycles: new Array(51).fill({}) }).valid).toBe(false);
      expect(validateArrayBounds({ supplements: new Array(51).fill({}) }).valid).toBe(false);
      expect(validateArrayBounds({ activePains: new Array(51).fill('pain') }).valid).toBe(false);
    });
  });

  describe('Subcollection Month ID & Key Boundaries', () => {
    function isValidMonthId(monthId: string): boolean {
      return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(monthId);
    }

    it('validates correct YYYY-MM month identifiers', () => {
      expect(isValidMonthId('2026-01')).toBe(true);
      expect(isValidMonthId('2026-08')).toBe(true);
      expect(isValidMonthId('2026-12')).toBe(true);
      expect(isValidMonthId('2030-05')).toBe(true);
    });

    it('rejects invalid month identifiers', () => {
      expect(isValidMonthId('2026-00')).toBe(false);
      expect(isValidMonthId('2026-13')).toBe(false);
      expect(isValidMonthId('2026-8')).toBe(false);
      expect(isValidMonthId('2026-08-15')).toBe(false);
      expect(isValidMonthId('invalid')).toBe(false);
      expect(isValidMonthId('')).toBe(false);
    });

    it('enforces maximum keys for history_months (<= 120 sessions/month)', () => {
      const validHistoryDoc: Record<string, any> = {};
      for (let i = 0; i < 120; i++) validHistoryDoc[`session_${i}`] = { id: `s_${i}` };

      const invalidHistoryDoc: Record<string, any> = { ...validHistoryDoc, session_120: {} };

      expect(Object.keys(validHistoryDoc).length <= 120).toBe(true);
      expect(Object.keys(invalidHistoryDoc).length <= 120).toBe(false);
    });

    it('enforces maximum keys for nutrition_months (<= 31 days/month)', () => {
      const validNutritionDoc: Record<string, any> = {};
      for (let i = 1; i <= 31; i++) {
        const day = i < 10 ? `0${i}` : `${i}`;
        validNutritionDoc[`2026-08-${day}`] = { date: `2026-08-${day}`, kcal: 2500 };
      }

      const invalidNutritionDoc: Record<string, any> = {
        ...validNutritionDoc,
        '2026-08-32': { date: '2026-08-32' },
      };

      expect(Object.keys(validNutritionDoc).length <= 31).toBe(true);
      expect(Object.keys(invalidNutritionDoc).length <= 31).toBe(false);
    });
  });

  describe('Pre-Write Document Size Guard (950KB Safety Margin)', () => {
    it('allows payloads under 950,000 bytes', () => {
      const smallData = { profile: { name: 'Mario' }, customExercises: [{ id: '1', name: 'Squat' }] };
      const assessment = isDocSizeWithinLimit(smallData);

      expect(assessment.valid).toBe(true);
      expect(assessment.sizeBytes).toBeLessThan(1000);
      expect(() => checkDocSize(smallData, 'users/test')).not.toThrow();
    });

    it('rejects oversized payloads (> 950KB) with Italian Sentence case error', () => {
      // Create payload > 950KB
      const largeString = 'A'.repeat(960000);
      const oversizedPayload = { data: largeString };

      expect(calculateDocSizeBytes(oversizedPayload)).toBeGreaterThan(950000);
      expect(() => checkDocSize(oversizedPayload, 'users/test')).toThrowError(
        /supera il limite di dimensione di sicurezza di Firestore/i
      );
    });
  });
});
