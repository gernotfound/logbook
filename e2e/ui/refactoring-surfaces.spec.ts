import { expect, test, type Page } from '../fixtures';
import type { TestInfo } from '@playwright/test';

test.describe.configure({ retries: 0 });

const appearances = [
  { preference: 'light', system: 'dark', resolved: 'light' },
  { preference: 'dark', system: 'light', resolved: 'dark' },
  { preference: 'system', system: 'light', resolved: 'light' },
  { preference: 'system', system: 'dark', resolved: 'dark' },
] as const;
const viewports = [{ width: 320, height: 568 }, { width: 1280, height: 900 }];

async function capture(page: Page, testInfo: TestInfo, surface: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await testInfo.attach(surface, { body: await page.screenshot({ fullPage: surface !== 'data-detail', animations: 'disabled' }), contentType: 'image/png' });
}

for (const viewport of viewports) {
  for (const appearance of appearances) {
    test(`training and data surfaces at ${viewport.width}px in ${appearance.preference}/${appearance.system}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: appearance.system, reducedMotion: 'reduce' });
      await page.addInitScript(preference => localStorage.setItem('logbook:appearance:v1', preference), appearance.preference);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', appearance.resolved);
      await expect(page.locator('html')).toHaveAttribute('data-theme-preference', appearance.preference);
      await page.getByRole('button', { name: 'Continua senza account' }).click();
      await page.getByText('Aggiornamento Termini e Privacy').waitFor();
      for (const checkbox of await page.locator('input[type="checkbox"]').all()) await checkbox.check();
      await page.getByRole('button', { name: 'Accetta e Continua' }).click();
      await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
      await expect(page.locator('.session-setup-page')).toBeVisible();
      await capture(page, testInfo, 'training-setup');

      await page.getByRole('tab', { name: 'Esercizi', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Crea esercizio' })).toBeVisible();
      await capture(page, testInfo, 'training-exercises');
      await page.getByRole('button', { name: 'Crea esercizio' }).click();
      await expect(page.getByRole('heading', { name: 'Nuovo esercizio', exact: true })).toBeVisible();
      await capture(page, testInfo, 'exercise-editor');
      await page.locator('#exercise-creation-form').getByRole('button', { name: 'Chiudi', exact: true }).click();
      await page.getByRole('tab', { name: 'Schede', exact: true }).click();
      await page.getByRole('button', { name: 'Crea scheda' }).click();
      await page.getByPlaceholder('Nome scheda').fill('Scheda controllo layout');
      await expect(page.locator('.routine-editor-muscle-map svg')).toBeVisible();
      await capture(page, testInfo, 'routine-editor');
      await page.locator('#routine-creation-form').getByRole('button', { name: 'Salva', exact: true }).click();
      const card = page.locator('.routine-library-card').filter({ hasText: 'Scheda controllo layout' });
      const trigger = card.getByRole('button', { name: 'Opzioni' });
      await trigger.focus();
      await page.keyboard.press('ArrowDown');
      const menu = card.getByRole('menu');
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      const menuBounds = await menu.boundingBox();
      expect(menuBounds).not.toBeNull();
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(viewport.width);
      await capture(page, testInfo, 'routine-menu');
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();

      await page.getByRole('tab', { name: 'Sessione', exact: true }).click();
      await page.getByRole('button', { name: 'Allenamento libero' }).click();
      await page.getByRole('button', { name: 'Salta check-in e inizia' }).click();
      await expect(page.locator('.workout-sticky-timer')).toBeVisible();
      await capture(page, testInfo, 'active-workout');

      await page.getByRole('button', { name: 'Opzioni timer' }).click();
      await page.getByRole('menuitem', { name: 'Metronomo' }).click();
      const metronome = page.locator('.workout-metronome-panel');
      await expect(metronome).toBeVisible();
      const timerShell = page.locator('.workout-timer-shell');
      await timerShell.evaluate(element => { element.style.width = '224px'; });
      const metronomeGeometry = await metronome.evaluate(panel => {
        const controls = panel.querySelector('.workout-metronome-controls');
        if (!controls) throw new Error('Metronome controls not found');
        const area = controls.getBoundingClientRect();
        return {
          buttons: [...controls.querySelectorAll('button, input')].map(control => {
            const rect = control.getBoundingClientRect();
            return {
              left: rect.left, right: rect.right,
              top: rect.top, height: rect.height,
            };
          }),
          left: area.left, right: area.right,
        };
      });
      expect(metronomeGeometry.buttons).toHaveLength(4);
      for (const control of metronomeGeometry.buttons) {
        expect(control.left).toBeGreaterThanOrEqual(metronomeGeometry.left - 1);
        expect(control.right).toBeLessThanOrEqual(metronomeGeometry.right + 1);
        expect(control.height).toBeGreaterThanOrEqual(44);
      }
      expect(metronomeGeometry.buttons[3].top)
        .toBeGreaterThan(metronomeGeometry.buttons[0].top + 20);
      await timerShell.evaluate(element => { element.style.removeProperty('width'); });
      await page.getByRole('button', { name: 'Opzioni timer' }).click();
      await page.getByRole('menuitem', { name: 'Chiudi metronomo' }).click();

      await page.getByRole('button', { name: /Termina/ }).click();
      await page.getByRole('button', { name: 'Salva e termina' }).click();
      const report = page.getByRole('dialog');
      const reportClose = report.getByRole('button', { name: 'Chiudi', exact: true });
      await expect(reportClose).toBeFocused();
      await capture(page, testInfo, 'workout-report');
      await page.keyboard.press('Escape');
      await expect(report).toHaveCount(0);
      await page.getByRole('button', { name: 'Allenamento', exact: true }).click();
      await page.getByRole('tab', { name: 'Storico', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Storico allenamenti', exact: true })).toBeVisible();
      await expect(page.locator('#training-panel-history .history-calendar-grid')).toBeVisible();
      // Adjacent dates in both calendars are interactive, not disabled.
      await expect(page.locator('.training-history .history-day.outside').first()).toHaveCSS('opacity', '1');
      await capture(page, testInfo, 'training-history');

      await page.getByRole('button', { name: 'Dati e statistiche', exact: true }).click();
      await page.getByRole('tab', { name: 'Misurazioni', exact: true }).click();
      await page.locator('#measure-weight').fill('81.4');
      await expect(page.locator('#measure-bf')).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: /Calcola la massa grassa/i })).not.toBeChecked();
      await page.locator('#measure-waist').fill('84.2');
      await page.locator('#measure-neck').fill('38');
      await capture(page, testInfo, 'measurements');
      await page.getByRole('button', { name: 'Salva misurazione', exact: true }).click();
      for (const name of ['Sonno', 'Attività', 'Biometria']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
        await capture(page, testInfo, `data-${name}`);
      }
      await page.getByRole('tab', { name: 'Storico', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Storico Dati', exact: true })).toBeVisible();
      const outsideDay = page.locator('#view-data .history-day.outside:not(.selected):not(.today)').first();
      await expect(outsideDay).toBeEnabled();
      // Adjacent-month days remain actionable, so muted text must still meet WCAG AA.
      const adjacentContrast = await outsideDay.evaluate(day => {
        const style = getComputedStyle(day);
        const panel = day.closest('.history-calendar-panel');
        if (!panel) throw new Error('Missing calendar background');
        const parse = (color: string) => {
          const channels = color.match(/[0-9.]+/g)?.slice(0, 3).map(Number);
          if (!channels || channels.length !== 3) throw new Error('Unexpected computed color');
          return channels;
        };
        const text = parse(style.color);
        const background = parse(getComputedStyle(panel).backgroundColor);
        const opacity = Number(style.opacity);
        const composite = text.map((value, index) => value * opacity + background[index] * (1 - opacity));
        const luminance = (rgb: number[]) => rgb.map(channel => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const lightness = luminance(composite);
        const backdrop = luminance(background);
        return (Math.max(lightness, backdrop) + 0.05) / (Math.min(lightness, backdrop) + 0.05);
      });
      expect(adjacentContrast).toBeGreaterThanOrEqual(4.5);
      await capture(page, testInfo, 'data-history');
      const detailTrigger = page.getByRole('button', { name: /Apri dettaglio/i });
      await detailTrigger.focus();
      await page.keyboard.press('Enter');
      const detail = page.getByRole('dialog', { name: 'Dettaglio dati' });
      const detailClose = detail.getByRole('button', { name: 'Chiudi dettaglio', exact: true });
      await expect(detailClose).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(detail.getByRole('button', { name: 'Modifica', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(detailClose).toBeFocused();
      const detailBounds = await detail.boundingBox();
      expect(detailBounds).not.toBeNull();
      expect(detailBounds!.x).toBeGreaterThanOrEqual(0);
      expect(detailBounds!.y).toBeGreaterThanOrEqual(0);
      expect(detailBounds!.x + detailBounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(detailBounds!.y + detailBounds!.height).toBeLessThanOrEqual(viewport.height + 1);
      for (const action of await detail.getByRole('button').all()) {
        expect(await action.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return hit !== null && element.contains(hit);
        }), 'modal actions must be above navigation and status overlays').toBe(true);
      }
      expect(await page.locator('.bottom-nav').evaluate(nav => {
        const rect = nav.getBoundingClientRect();
        return Boolean(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest('.data-detail-layer'));
      })).toBe(true);
      await capture(page, testInfo, 'data-detail');
      await page.keyboard.press('Escape');
      await expect(detail).toHaveCount(0);
      await expect(detailTrigger).toBeFocused();
    });
  }
}
