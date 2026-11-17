import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertStableWriterEvidence } from '../../../src/lib/sync/writerEvidenceConsistency';
import { readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { readDeviceConsentRevision } from '../../../src/lib/sync/workoutDeviceIntent';

vi.mock('../../../src/lib/sync/deviceStorage', () => ({ readDeviceValueStrict: vi.fn() }));
vi.mock('../../../src/lib/sync/workoutDeviceIntent', () => ({ readDeviceConsentRevision: vi.fn() }));

const owner = 'user:writer-consistency';
const names = new Set(['w1', 'w2']);
const scanned = [{ name: 'w1', raw: 'first' }, { name: 'w2', raw: 'second' }];
const messages = { inventory: 'inventory changed', value: 'value changed' };
const check = (readNames: () => Set<string> = () => new Set(names)) =>
    assertStableWriterEvidence(owner, names, 3, scanned, readNames, messages);

describe('shared independent-writer evidence consistency', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(readDeviceConsentRevision).mockReturnValue(3);
        vi.mocked(readDeviceValueStrict).mockImplementation(name => scanned.find(x => x.name === name)?.raw ?? null);
    });

    it('accepts stable membership, bytes and consent only after final verification', () => {
        expect(() => check()).not.toThrow();
        expect(readDeviceValueStrict).toHaveBeenCalledTimes(2);
        expect(readDeviceConsentRevision).toHaveBeenCalledTimes(2);
    });

    it('rejects a newly added independent witness before selecting any recovery', () => {
        expect(() => check(() => new Set(['w1', 'w2', 'w3']))).toThrow('inventory changed');
        expect(readDeviceValueStrict).not.toHaveBeenCalled();
    });

    it('rejects a new independent witness inserted during authenticated final reads', () => {
        const current = new Set(names);
        const readNames = vi.fn(() => new Set(current));
        vi.mocked(readDeviceValueStrict).mockImplementation(name => {
            if (name === 'w1') current.add('w3');
            return scanned.find(item => item.name === name)?.raw ?? null;
        });
        expect(() => check(readNames)).toThrow('inventory changed');
        expect(readNames).toHaveBeenCalledTimes(2);
        expect(readDeviceValueStrict).toHaveBeenCalledTimes(2);
    });

    it('rejects replacement of an unrelated witness even when the names are unchanged', () => {
        vi.mocked(readDeviceValueStrict).mockImplementation(name => name === 'w1' ? 'first' : 'altered');
        expect(() => check()).toThrow('value changed');
    });

    it('rejects consent advancing after the last authenticated writer value', () => {
        vi.mocked(readDeviceConsentRevision).mockReturnValueOnce(3).mockReturnValueOnce(4);
        expect(() => check()).toThrow('inventory changed');
        expect(readDeviceValueStrict).toHaveBeenCalledTimes(2);
    });

    it('fails closed if an authenticated witness disappears during final reads', () => {
        vi.mocked(readDeviceValueStrict).mockReturnValueOnce('first').mockReturnValueOnce(null);
        expect(() => check()).toThrow('value changed');
    });
});
