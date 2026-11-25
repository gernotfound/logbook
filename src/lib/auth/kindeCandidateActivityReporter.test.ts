import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKindeCandidateActivityReporter } from './kindeCandidateActivityReporter';
import { KindeCandidateBoundaryError } from './kindeCandidateClient';

const A = 'A'.repeat(43);
const B = 'B'.repeat(42) + 'A';
const reply = (outcome = 'recorded') => new Response(JSON.stringify({ outcome }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

describe('candidate activity reporter (explicit foreground only)', () => {
    let now = 0;
    let csrf = A;
    const cookies = () => '__Host-logbook_csrf=' + csrf;

    beforeEach(() => {
        now = 0;
        csrf = A;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    });
    afterEach(() => vi.restoreAllMocks());

    const make = (send: typeof fetch, expectedCsrfToken = A) =>
        createKindeCandidateActivityReporter({ expectedCsrfToken, send, browserCookies: cookies });

    it('does not register on construction and coalesces concurrent foreground requests', async () => {
        let complete!: (response: Response) => void;
        const send = vi.fn<typeof fetch>().mockImplementationOnce(() =>
            new Promise(resolve => { complete = resolve; })).mockImplementation(async () => reply());
        const report = make(send);
        expect(send).not.toHaveBeenCalled();
        const pending = report(() => true);
        await expect(report(() => true)).resolves.toBe('skipped');
        expect(send).toHaveBeenCalledTimes(1);
        complete(reply());
        await expect(pending).resolves.toBe('recorded');
        now = 599_999;
        await expect(report(() => true)).resolves.toBe('skipped');
        now = 600_000;
        await expect(report(() => true)).resolves.toBe('recorded');
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('does not count denied or lost responses and requires a new action after backoff', async () => {
        const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost reply'))
            .mockImplementation(async () => reply('observed'));
        const report = make(send);
        await expect(report(() => true)).resolves.toBe('unavailable');
        now = 59_999;
        await expect(report(() => true)).resolves.toBe('skipped');
        expect(send).toHaveBeenCalledTimes(1);
        now = 60_000;
        expect(send).toHaveBeenCalledTimes(1);
        await expect(report(() => true)).resolves.toBe('observed');
        now = 659_999;
        await expect(report(() => true)).resolves.toBe('skipped');
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('does not consume cooldown when hidden, offline or called by a stale generation', async () => {
        const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        const send = vi.fn<typeof fetch>().mockImplementation(async () => reply());
        const report = make(send);
        await expect(report(() => true)).resolves.toBe('skipped');
        visible.mockReturnValue('visible');
        online.mockReturnValue(false);
        await expect(report(() => true)).resolves.toBe('skipped');
        online.mockReturnValue(true);
        await expect(report(() => false)).resolves.toBe('skipped');
        expect(send).not.toHaveBeenCalled();
        await expect(report(() => true)).resolves.toBe('recorded');
    });

    it('rejects a replacement session and never shares cooldown with the new witness', async () => {
        const send = vi.fn<typeof fetch>().mockImplementation(async () => reply());
        const old = make(send);
        await expect(old(() => true)).resolves.toBe('recorded');
        csrf = B;
        await expect(old(() => true)).resolves.toBe('skipped');
        expect(() => make(send)).toThrow(KindeCandidateBoundaryError);
        const next = make(send, B);
        await expect(next(() => true)).resolves.toBe('recorded');
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('does not publish a receipt to a stale caller even when the request succeeded', async () => {
        let current = true;
        const send = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
            current = false;
            return reply();
        }).mockImplementation(async () => reply());
        const report = make(send);
        await expect(report(() => current)).resolves.toBe('unavailable');
        now = 60_000;
        await expect(report(() => true)).resolves.toBe('recorded');
        expect(send).toHaveBeenCalledTimes(2);
    });
});
