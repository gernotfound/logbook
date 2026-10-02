import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public TheLogBook branding', () => {
  it('keeps install metadata and primary UI aligned to TheLogBook', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8');
    const indexHtml = readFileSync('index.html', 'utf8');
    const homeHeader = readFileSync('src/components/Home/widgets/HeaderDashboard.tsx', 'utf8');
    const loginBox = readFileSync('src/components/UI/LoginBox.tsx', 'utf8');

    expect(viteConfig).toContain("name: 'TheLogBook'");
    expect(viteConfig).toContain("short_name: 'TheLogBook'");
    expect(indexHtml).toContain('<title>TheLogBook</title>');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title" content="TheLogBook"');
    expect(homeHeader).toContain('<h1>TheLogBook</h1>');
    expect(loginBox).toContain('>TheLogBook</h1>');
  });
});
