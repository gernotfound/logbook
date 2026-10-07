import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public TheLogBook branding', () => {
  it('keeps install metadata and primary UI aligned to TheLogBook', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8');
    const indexHtml = readFileSync('index.html', 'utf8');
    const appearanceCss = readFileSync('public/appearance.css', 'utf8');
    const loadingArtwork = readFileSync('public/loading-wait.svg', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');
    const brandLoadingScreen = readFileSync('src/components/UI/BrandLoadingScreen.tsx', 'utf8');
    const homeHeader = readFileSync('src/components/Home/widgets/HeaderDashboard.tsx', 'utf8');
    const loginBox = readFileSync('src/components/UI/LoginBox.tsx', 'utf8');

    expect(viteConfig).toContain("name: 'TheLogBook'");
    expect(viteConfig).toContain("short_name: 'TheLogBook'");
    expect(indexHtml).toContain('<title>TheLogBook</title>');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title" content="TheLogBook"');
    expect(indexHtml).toContain('class="brand-loading-screen"');
    expect(indexHtml).toContain('class="brand-loading-screen__mascot"');
    expect(indexHtml).toContain('src="%BASE_URL%loading-wait.svg?v=20261007-waiting-mascot"');
    expect(indexHtml).toContain('<div class="brand-loading-screen__wordmark" data-text="Caricamento"><h1>Caricamento</h1></div>');
    expect(indexHtml).not.toContain('initial-spinner');
    expect(indexHtml).not.toContain('Caricamento...');
    expect(loadingArtwork).toContain('<title id="title">Cuoco in attesa</title>');
    expect(loadingArtwork).toContain('viewBox="0 0 1254 1254"');
    expect(brandLoadingScreen).toContain('brand-loading-screen__mascot');
    expect(brandLoadingScreen).toContain('brand-loading-screen__wordmark');
    expect(app).toContain('<BrandLoadingScreen label="Avvio di TheLogBook in corso" />');
    expect(app).toContain('<BrandLoadingScreen label="Preparazione account in corso" />');
    expect(app).toContain('<BrandLoadingScreen variant="content" label="Caricamento sezione in corso" />');
    expect(app).not.toContain('auth-spinner');
    expect(app).not.toContain('className="app-loading"');
    expect(appearanceCss).toContain('background: #000000;');
    expect(appearanceCss).toContain('color: #ffffff;');
    expect(appearanceCss).toContain('--brand-loading-scale: 0.72;');
    expect(appearanceCss).toContain('transform: translateY(var(--brand-loading-offset-y)) scale(var(--brand-loading-scale));');
    expect(appearanceCss).toContain('html:has(.brand-loading-screen)');
    expect(appearanceCss).toContain('position: fixed;');
    expect(appearanceCss).toContain('touch-action: none;');
    expect(appearanceCss).toContain('inset: 0 0 calc(var(--nav-height) + env(safe-area-inset-bottom, 0px)) 0;');
    expect(appearanceCss).not.toContain('min-height: 70dvh;');
    expect(appearanceCss).not.toContain('.brand-loading-screen--content .brand-loading-screen__mascot');
    expect(appearanceCss).toContain('animation: brand-loading-bloom-pulse 1.9s ease-in-out infinite;');
    expect(homeHeader).toContain('<h1>TheLogBook</h1>');
    expect(loginBox).toContain('>TheLogBook</h1>');
  });
});
