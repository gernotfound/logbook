import { expect, test } from '../fixtures';
import { mountKindePlanning, withKindeReplicaDevices } from './kindeReplicaFixture';

test('records a trusted candidate interaction once per session across identity refreshes', async ({ browser }) => {
    await withKindeReplicaDevices(browser, async ({ first }) => {
        const requests: string[] = [];
        const activity = '/v1/account/activity';
        first.on('request', request => {
            if (new URL(request.url()).pathname === activity) requests.push(request.postData() ?? '');
        });
        await first.bringToFront();
        await mountKindePlanning(first);
        const ready = first.getByRole('button', { name: 'Apri archivio account' });
        const heading = first.getByRole('heading', { name: /Accesso Kinde/ });
        await expect(ready).toBeVisible();

        const refresh = async () => {
            const response = first.waitForResponse(response => response.url().endsWith('/v1/consent/status'));
            await first.evaluate(() => window.dispatchEvent(new Event('online')));
            expect((await response).status()).toBe(200);
            await expect(ready).toBeVisible();
        };
        await heading.dispatchEvent('click');
        await refresh();
        expect(requests).toEqual([]);

        const observe = async () => {
            const response = first.waitForResponse(response => response.url().endsWith(activity));
            await heading.click();
            const receipt = await response;
            expect(receipt.status()).toBe(200);
            return receipt.json();
        };
        expect(await observe()).toEqual({ outcome: 'recorded' });
        // A failed identity probe hides the candidate. Recovery of the same
        // session must preserve its cooldown even after the unavailable view.
        await first.route('**/api/auth/session', route => route.abort(), { times: 1 });
        await first.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(first.getByRole('button', { name: 'Riprova la verifica' })).toBeVisible();
        await refresh();
        await heading.click();
        expect(requests).toEqual(['{}']);

        // Replace both host cookies without reloading React. Even the same UID
        // has a fresh session and must not inherit the previous cooldown.
        const replacement = await first.request.get(new URL('/session/second', first.url()).href);
        expect(replacement.ok()).toBe(true);
        await refresh();
        expect(await observe()).toEqual({ outcome: 'observed' });
        expect(requests).toEqual(['{}', '{}']);
    }, { planningUi: true, foregroundActivity: true });
});