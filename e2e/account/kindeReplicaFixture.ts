import type { Browser, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const modulePath = '/kinde-replica-fixture.mjs';

declare global {
    interface Window { kindeReplicaFixture?: KindeCandidateFitnessRealm }
}

async function buildClient(planningUi: boolean): Promise<string> {
    const entry = planningUi ? './kindePlanningBrowserEntry.ts' : '../../src/lib/auth/kindeCandidateFitnessRealm.ts';
    const output = await build({
        configFile: false, envDir: false, publicDir: false, logLevel: 'error',
        define: {
            __APP_VERSION__: JSON.stringify('kinde-e2e-fixture'),
            'process.env.NODE_ENV': JSON.stringify('production'),
        },
        build: {
            write: false,
            lib: {
                entry: fileURLToPath(new URL(entry, import.meta.url)),
                formats: ['es'],
            },
            ...(planningUi ? { rolldownOptions: { output: { codeSplitting: false } } } : {}),
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
    }, { absoluteModule: new URL(modulePath, page.url()).href, principal: expected });
}

export async function mountKindePlanning(page: Page) {
    await page.evaluate(async absoluteModule => {
        const { mountKindePlanning: mount } = await import(absoluteModule) as typeof import('./kindePlanningBrowserEntry');
        mount();
    }, new URL(modulePath, page.url()).href);
}

async function startHttpsFixture(serve: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
    const work = await mkdtemp(join(tmpdir(), 'kinde-replica-e2e-'));
    try {
        const keyFile = join(work, 'key.pem');
        const certFile = join(work, 'cert.pem');
        execFileSync('openssl', [
            'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
            '-keyout', keyFile, '-out', certFile,
        ], { stdio: 'ignore' });
        const [key, cert] = await Promise.all([readFile(keyFile), readFile(certFile)]);
        const server = createServer({ key, cert }, (request, response) => {
            void serve(request, response).catch(() => { response.writeHead(500).end(); });
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Kinde fixture address unavailable');
        return {
            origin: `https://127.0.0.1:${address.port}`,
            close: () => new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections();
            }),
        };
    } finally { await rm(work, { recursive: true, force: true }); }
}

export async function withKindeReplicaDevices<T>(
    browser: Browser,
    run: (devices: {
        first: Page; second: Page; receipts: () => number;
        firstCommitStatuses: number[]; allowFirstCommit: () => void;
        beforeFirstDocumentRead: (action: () => Promise<void>) => void;
    }) => Promise<T>,
    { planningUi = false }: { planningUi?: boolean } = {},
): Promise<T> {
    const client = await buildClient(planningUi);
    const fixture = await createCloudKeyHttpFixture([uid]);
    const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
    let server: Awaited<ReturnType<typeof startHttpsFixture>> | undefined;
    let refuseFirstCommit = true;
    const firstCommitStatuses: number[] = [];
    const beforeFirstReads: Array<() => Promise<void>> = [];
    const receipts = () => {
        const count = fixture.count('sync_receipts', uid);
        if (typeof count !== 'number') throw new Error('Receipt count unavailable');
        return count;
    };

    try {
        await fixture.consent(uid);
        const firstCookies: string[] = (await issueVerifiedSession(fixture.db, uid)).setCookies;
        const secondCookies: string[] = (await issueVerifiedSession(fixture.db, uid)).setCookies;
        const firstSession = firstCookies[0].split(';')[0];
        // Use Set-Cookie over actual loopback TLS so WebKit and Chromium apply
        // their own host-only Secure/HttpOnly rules. The synthetic sign-in is
        // invoked once per profile and never runs during archive recovery.
        const env = { ...fixture.env, APP_ORIGIN: ORIGIN };
        const listening = server = await startHttpsFixture(async (incoming, outgoing) => {
            const origin = server!.origin;
            const url = new URL(incoming.url ?? '/', origin);
            if (url.origin !== origin) { outgoing.writeHead(400).end(); return; }
            if (incoming.method === 'GET') {
                if (url.pathname === '/session/first' || url.pathname === '/session/second') {
                    outgoing.writeHead(303, {
                        'Set-Cookie': url.pathname === '/session/first' ? firstCookies : secondCookies,
                        Location: '/', 'Cache-Control': 'no-store',
                    }).end();
                } else if (url.pathname === '/') {
                    outgoing.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Kinde replica fixture</title>');
                } else if (url.pathname === modulePath) {
                    outgoing.writeHead(200, { 'Content-Type': 'text/javascript' }).end(client);
                } else { outgoing.writeHead(404).end(); }
                return;
            }
            if (incoming.method !== 'POST' || incoming.headers.origin !== origin) {
                outgoing.writeHead(403).end();
                return;
            }
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
                if (typeof value === 'string') headers.set(name, value);
            }
            headers.set('origin', ORIGIN);
            let body = '';
            incoming.setEncoding('utf8');
            for await (const chunk of incoming) body += chunk;
            const isFirst = (headers.get('cookie') ?? '').split('; ').includes(firstSession);
            if (isFirst && url.pathname === '/v1/sync/read') {
                // Interleave only the first profile's reads. The callback can
                // complete a real commit from the second profile meanwhile.
                await beforeFirstReads.shift()?.();
            }
            const commit = isFirst && url.pathname === '/v1/sync/commit';
            const response = commit && refuseFirstCommit
                ? Response.json({ error: 'unavailable' }, { status: 429 })
                : await routeCandidateFirstPartyApi(new Request(ORIGIN + url.pathname + url.search, {
                    method: 'POST', headers, body: body || null,
                }), {
                    APP_ORIGIN: ORIGIN,
                    KINDE_HTTP: { fetch: (input: Request) => kinde.fetch(input, env) },
                    D1_API: { fetch: (input: Request) => api.fetch(input, env) },
                });
            if (commit) firstCommitStatuses.push(response.status);
            const bytes = Buffer.from(await response.arrayBuffer());
            outgoing.writeHead(response.status, Object.fromEntries(response.headers)).end(bytes);
        });
        async function createDevice(device: 'first' | 'second') {
            const context = await browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: true });
            contexts.push(context);
            await context.route('**/*', route => new URL(route.request().url()).origin === listening.origin
                ? route.continue() : route.abort('blockedbyclient'));
            const page = await context.newPage();
            await page.goto(`${listening.origin}/session/${device}`);
            if (!await page.evaluate(() => document.cookie.includes('__Host-logbook_csrf='))) {
                throw new Error('The test browser did not retain the synthetic CSRF cookie');
            }
            return page;
        }
        const first = await createDevice('first');
        const second = await createDevice('second');
        await loadKindeReplica(second);
        if (!planningUi) await loadKindeReplica(first);
        return await run({
            first, second, receipts, firstCommitStatuses,
            allowFirstCommit: () => { refuseFirstCommit = false; },
            beforeFirstDocumentRead: action => { beforeFirstReads.push(action); },
        });
    } finally {
        try { await Promise.all(contexts.map(context => context.close())); }
        finally {
            try { await server?.close(); }
            finally { fixture.close(); }
        }
    }
}
