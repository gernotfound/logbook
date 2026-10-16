import { describe, expect, it, vi } from 'vitest';
import { parseLargeBackupJson } from '../src/lib/streamJsonImport';

describe('bounded-source JSON backup reader', () => {
    it('matches JSON.parse across tiny read boundaries and UTF-8 escape splits', async () => {
        const raw = JSON.stringify({
            format: 'logbook-backup',
            userData: { history: [{ id: 'a', note: 'Caffè 😀' }, { id: 'b', note: 'a\\nb' }] },
            recovery: { device: { workout: '{ "a": 1 }' } },
            values: [true, false, null, -12.25e3, [], {}, ''],
        });
        const file = new File([raw], 'data.json');
        const check = vi.fn();
        const decoded = await parseLargeBackupJson(file, check, 3);
        expect(decoded).toEqual(JSON.parse(raw));
        expect(check).toHaveBeenCalled();
    });

    it('supports duplicate object keys, including __proto__, without prototype mutation', async () => {
        const raw = '{"__proto__":{"polluted":true},"value":0,"value":1}';
        const parsed = await parseLargeBackupJson(new Blob([raw]), undefined, 4) as Record<string, unknown>;
        expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
        expect(parsed.value).toBe(1);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(parsed).toEqual(JSON.parse(raw));
    });

    it.each([
        '{"x":1,}', '[1,]', '{"x" 1}', '{"x":true false}', '[01]',
        '{"x":"unterminated}', '{"x":}', '{"x":[1,2}', 'true false',
    ])('rejects malformed JSON before it can be imported: %s', async raw => {
        await expect(parseLargeBackupJson(new Blob([raw]), undefined, 2))
            .rejects.toThrow('Formato JSON non valido');
    });

    it('does not accept an invalid UTF-8 sequence or a truncated read', async () => {
        await expect(parseLargeBackupJson(new Blob([Uint8Array.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125])]), undefined, 2)).rejects.toThrow();
        const file = { size: 3, slice: () => new Blob([]) } as unknown as Blob;
        await expect(parseLargeBackupJson(file)).rejects.toThrow('Lettura JSON incompleta');
    });

    it('checks the owner session during each chunk, including before returning', async () => {
        let calls = 0;
        await expect(parseLargeBackupJson(new Blob(['{"x":1}']), () => {
            if (++calls === 3) throw new Error('Sessione cambiata');
        }, 2)).rejects.toThrow('Sessione cambiata');
    });
});
