import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GA4 frontend boundary', () => {
  it('does not ship Vercel Analytics or Speed Insights in App', () => {
    const source = readFileSync('src/App.tsx', 'utf8');
    expect(source).not.toContain('@vercel/analytics');
    expect(source).not.toContain('@vercel/speed-insights');
    expect(source).not.toContain('<Analytics');
    expect(source).not.toContain('<SpeedInsights');
  });

  it('uses a provider-specific consent key so legacy Vercel consent cannot opt into GA4', () => {
    const source = readFileSync('src/lib/analyticsConsent.ts', 'utf8');
    expect(source).toContain("logbook_ga4_consent_v1");
    expect(source).not.toContain("logbook_analytics_consent");
  });

  it('clears a rejected analytics initialization so a later attempt can retry', () => {
    const source = readFileSync('src/lib/googleAnalytics.ts', 'utf8');
    expect(source).toContain('if (initialization === attempt) initialization = null');
  });
});
