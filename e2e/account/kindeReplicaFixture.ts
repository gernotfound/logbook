import type { Browser, Page, Route } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import api from '../../cloudflare/api/worker.mjs';
import kinde from '../../cloudflare/auth/kinde-http-worker.mjs';
import { issueVerifiedSession } from '../../cloudflare/auth/session-issuer.mjs';
import { routeCandidateFirstPartyApi } from '../../cloudflare/first-party-api-candidate.mjs';
import type { KindeCandidateFitnessRealm } from '../../src/lib/auth/kindeCandidateFitnessRealm';
import { createCloudKeyHttpFixture, ORIGIN } from '../../tests/cloudflare/cloud-key-http-fixture.mjs';

const uid = 'k_' + 'T'.repeat(43);
const expected = { uid, fenceEpoch: 1, healthConsentRevision: 1 };
const browserOrigin = 'https://127.0.0.1';
const modulePath = '/kinde-replica-fixture.mjs';

declare global {
    interface Window { kindeReplicaFixture?: KindeCandidateFitnessRealm }
}

async function buildClient(): Promise<string> {
    const output = await build({
        configFile: false, envDir: false, publicDir: false, logLevel: 'error',
        define: { __APP_VERSION__: JSON.stringify('kinde-e2e-fixture') },
        build: {
            write: false,
            lib: {
                entry: fileURLToPath(new URL('../../src/lib/auth/kindeCandidateFitnessRealm.ts', import.meta.url)),
                formats: ['es'],
            },
        },
    });
    const builds = Array.isArray(output) ? output : [output];
    const files = builds.flatMap(item => 'output' in item ? item.output : []);
    const [file] = files;
    if (files.length !== 1 || file?.type !== 'chunk') throw new Error('Expected one isolated Kinde browser bundle');
    return file.code;
}

export async function loadKindeReplica(page: Page) {
    await page.evaluate(async ({ absoluteModule, principal }) => {
        const { openKindeCandidateFitnessRealm } = await import(absoluteModule) as
            typeof import('../../src/lib/auth/kindeCandidateFitnessRealm');
        window.kindeReplicaFixture = await openKindeCandidateFitnessRealm({
            expected: principal, stillCurrent: () => true,
        });
    }, { absoluteModule: browserOrigin + modulePath, principal: expected });
}

export async function withKindeReplicaDevices<T>(
    browser: Browser,
    run: (devices: {
        first: Page; second: Page; receipts: () => number;
        firstCommitStatuses: number[]; allowFirstCommit: () => void;
    }) => Promise<T>,
): Promise<T> {
    const client = await buildClient();
    const fixture = await createCloudKeyHttpFixture([uid]);
    const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
    let refuseFirstCommit = true;
    const firstCommitStatuses: number[] = [];
    const receipts = () => {
        const count = fixture.count('sync_receipts', uid);
        if (typeof count !== 'number') throw new Error('Receipt count unavailable');
        return count;
    };

    // Only the loopback fixture is fulfilled. Browsers still handle cookies,
    // Web Locks and IndexedDB. OAuth session issuance here uses synthetic SQL.
    async function serve(route: Route, first: boolean) {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== browserOrigin) return route.abort('blockedbyclient');
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Kinde replica fixture</title>' });
        if (url.pathname === modulePath) return route.fulfill({ contentType: 'text/javascript', body: client });
        if (!url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/v1/')) {
            return route.abort('blockedbyclient');
        }
        const headers = new Headers(await request.allHeaders());
        if (headers.get('origin') === browserOrigin) headers.set('origin', ORIGIN);
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        const commit = first && url.pathname === '/v1/sync/commit';
        const response = commit && refuseFirstCommit
            ? Response.json({ error: 'unavailable' }, { status: 429 })
            : await routeCandidateFirstPartyApi(new Request(ORIGIN + url.pathname, {
                method: request.method(), headers, body: request.postData(),
            }), {
                APP_ORIGIN: ORIGIN,
                KINDE_HTTP: { fetch: (input: Request) => kinde.fetch(input, env) },
                D1_API: { fetch: (input: Request) => api.fetch(input, env) },
            });
        if (commit) firstCommitStatuses.push(response.status);
        await route.fulfill({
            status: response.status, headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
        });
    }

    try {
        await fixture.consent(uid);
        const firstCookies = fixture.sessions.get(uid).cookies.split('; ');
        const secondCookies = (await issueVerifiedSession(fixture.db, uid)).setCookies
            .map((cookie: string) => cookie.split(';')[0]);
        async function createDevice(cookies: string[], first: boolean) {
            const context = await browser.newContext({ serviceWorkers: 'block' });
            contexts.push(context);
            await context.route('**/*', route => serve(route, first));
            await context.addCookies(cookies.map(cookie => {
                const [name, value] = cookie.split('=');
                return { name, value, url: browserOrigin, secure: true, httpOnly: name.endsWith('_session'), sameSite: 'Lax' };
            }));
            const page = await context.newPage();
            await page.goto(browserOrigin);
            return page;
        }
        const first = await createDevice(firstCookies, true);
        const second = await createDevice(secondCookies, false);
        await loadKindeReplica(second);
        await loadKindeReplica(first);
        return await run({
            first, second, receipts, firstCommitStatuses,
            allowFirstCommit: () => { refuseFirstCommit = false; },
        });
    } finally {
        try { await Promise.all(contexts.map(context => context.close())); }
        finally { fixture.close(); }
    }
}
