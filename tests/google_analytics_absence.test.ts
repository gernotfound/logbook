import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Google/Firebase Analytics removal', () => {
    const read = (relativePath: string) =>
        fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf-8');

    it('keeps runtime Firebase configuration free of Analytics initialization', () => {
        const firebase = read('src/lib/firebase.ts');
        const app = read('src/App.tsx');

        expect(firebase).not.toContain('firebase/analytics');
        expect(firebase).not.toContain('measurementId');
        expect(firebase).not.toContain('VITE_FIREBASE_MEASUREMENT_ID');
        expect(app).not.toContain('firebase/analytics');
        expect(app).not.toContain('getConsentedAnalytics');
    });

    it('does not require a Google Analytics measurement ID from app environments', () => {
        for (const relativePath of ['.env.example', '.env.production', '.env.test', 'scripts/run-e2e.mjs']) {
            expect(read(relativePath)).not.toContain('VITE_FIREBASE_MEASUREMENT_ID');
        }
    });

    it('does not allow Google Analytics or Tag Manager endpoints in the production CSP', () => {
        const vercel = read('vercel.json');

        expect(vercel).not.toContain('google-analytics.com');
        expect(vercel).not.toContain('googletagmanager.com');
    });
});
