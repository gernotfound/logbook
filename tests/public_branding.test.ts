import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public TheLogBook branding', () => {
  it('keeps install metadata and primary UI aligned to TheLogBook', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8');
    const indexHtml = readFileSync('index.html', 'utf8');
    const appearanceCss = readFileSync('public/appearance.css', 'utf8');
    const homeHeader = readFileSync('src/components/Home/widgets/HeaderDashboard.tsx', 'utf8');
    const loginBox = readFileSync('src/components/UI/LoginBox.tsx', 'utf8');

    expect(viteConfig).toContain("name: 'TheLogBook'");
    expect(viteConfig).toContain("short_name: 'TheLogBook'");
    expect(indexHtml).toContain('<title>TheLogBook</title>');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title" content="TheLogBook"');
    expect(indexHtml).toContain('class="initial-loader-icon"');
    expect(indexHtml).toContain('src="%BASE_URL%icon.svg?v=20261006-vector-master"');
    expect(indexHtml).toContain('<div class="initial-wordmark" data-text="TheLogBook"><h1>TheLogBook</h1></div>');
    expect(indexHtml).not.toContain('initial-spinner');
    expect(indexHtml).not.toContain('Caricamento...');
    expect(appearanceCss).toContain('background: #000000;');
    expect(appearanceCss).toContain('color: #ffffff;');
    expect(appearanceCss).toContain('animation: initial-bloom-pulse 1.9s ease-in-out infinite;');
    expect(homeHeader).toContain('<h1>TheLogBook</h1>');
    expect(loginBox).toContain('>TheLogBook</h1>');
  });
});
