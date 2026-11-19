import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useKindeAccountSession } from '../../../src/contexts/auth/useKindeAccountSession';
import { KindeCandidateRestorePanel } from '../../../src/components/UI/KindeCandidateRestorePanel';

type Session = ReturnType<typeof useKindeAccountSession>;
const selected = (contents: string) => {
    const file = new File([contents], 'backup.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => contents });
    return file;
};
function mount(restore: Session['restoreCandidateBackup']) {
    const session = { busy: false, restoreCandidateBackup: restore } as Session;
    const view = render(<KindeCandidateRestorePanel session={session} />);
    const file = screen.getByLabelText('File backup JSON');
    const confirm = screen.getByLabelText(/Confermo di voler ripristinare questo backup/);
    const start = screen.getByRole('button', { name: 'Avvia ripristino' });
    return { ...view, file, confirm, start };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('CF-05 candidate-only restore entry', () => {
    it('requires explicit file and confirmation before invoking the guarded restore', async () => {
        const restore = vi.fn<Session['restoreCandidateBackup']>()
            .mockResolvedValue({ kind: 'cloud-acknowledged' });
        const ui = mount(restore);
        expect(ui.start).toBeDisabled();
        fireEvent.change(ui.file, { target: { files: [selected('{"type":"backup"}')] } });
        expect(ui.start).toBeDisabled();
        fireEvent.click(ui.confirm);
        fireEvent.click(ui.start);
        await screen.findByText(/Ripristino confermato dal server/);
        expect(restore).toHaveBeenCalledTimes(1);
        expect(restore).toHaveBeenCalledWith({ type: 'backup' });
    });

    it('preserves the distinction between locally pending and cloud-acknowledged', async () => {
        const restore = vi.fn<Session['restoreCandidateBackup']>()
            .mockResolvedValue({ kind: 'local-pending', pendingCount: 2 });
        const ui = mount(restore);
        fireEvent.change(ui.file, { target: { files: [selected('{}')] } });
        fireEvent.click(ui.confirm);
        fireEvent.click(ui.start);
        expect(await screen.findByText(/conferma cloud ancora in attesa/)).toHaveTextContent('2 operazioni');
        expect(screen.queryByText(/Ripristino confermato dal server/)).toBeNull();
    });

    it('never calls restore for unreadable JSON or unmounted pending file read', async () => {
        const restore = vi.fn<Session['restoreCandidateBackup']>()
            .mockResolvedValue({ kind: 'cloud-acknowledged' });
        const ui = mount(restore);
        fireEvent.change(ui.file, { target: { files: [selected('{not-json')] } });
        fireEvent.click(ui.confirm);
        fireEvent.click(ui.start);
        await screen.findByRole('alert');
        expect(restore).not.toHaveBeenCalled();
        ui.unmount();

        let release!: (contents: string) => void;
        const pending = new Promise<string>(resolve => { release = resolve; });
        const delayed = selected('{}');
        Object.defineProperty(delayed, 'text', { value: () => pending, configurable: true });
        const second = mount(restore);
        fireEvent.change(second.file, { target: { files: [delayed] } });
        fireEvent.click(second.confirm);
        fireEvent.click(second.start);
        second.unmount();
        release('{}');
        await waitFor(() => expect(restore).not.toHaveBeenCalled());
    });
});
