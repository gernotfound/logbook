import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityCardioSection } from '../../../src/components/Data/activity/ActivityCardioSection';
import { timestampToLocalTime } from '../../../src/lib/activity';
import { EMPTY_CARDIO_DRAFT } from '../../../src/lib/activityCardioForm';
import type { CardioSession } from '../../../src/types';

describe('activity cardio timestamp presentation', () => {
    it('renders a valid zero-epoch event and omits invalid Date timestamps', () => {
        const cardioSessions: CardioSession[] = [
            { id: 'epoch', modality: 'walk', durationMinutes: 10, intensity: 'low', startedAt: 0 },
            { id: 'large', modality: 'bike', durationMinutes: 30, intensity: 'moderate', startedAt: 1e200 },
        ];
        const startTime = timestampToLocalTime(0);
        expect(startTime).not.toBe('');
        expect(timestampToLocalTime(1e200)).toBe('');

        const { container } = render(<ActivityCardioSection activity={{
            cardioForm: EMPTY_CARDIO_DRAFT,
            cardioSessions,
            editingCardioId: null,
            isCreatingCardio: false,
            startNewCardio: vi.fn(),
            editCardio: vi.fn(),
            deleteCardio: vi.fn(),
            setCardioField: vi.fn(),
            cancelCardio: vi.fn(),
            saveCardio: vi.fn(),
        }} />);
        const cards = container.querySelectorAll('.activity-cardio-item');
        expect(cards).toHaveLength(2);
        expect(cards[0].querySelector('small')?.textContent).toBe(`Ore ${startTime}`);
        expect(cards[1].querySelector('small')).toBeNull();
        expect(screen.queryByText(/Invalid Date/i)).toBeNull();
        expect(screen.getByText('10 min · Intensità bassa')).toBeDefined();
        expect(screen.getByText('30 min · Intensità moderata')).toBeDefined();
    });
});

describe('cardio editor durable mutation barrier', () => {
    const activity = () => ({
        cardioForm: EMPTY_CARDIO_DRAFT,
        cardioSessions: [{ id: 'one', modality: 'walk' as const, durationMinutes: 10, intensity: 'low' as const }],
        editingCardioId: 'one',
        isCreatingCardio: false,
        startNewCardio: vi.fn(),
        editCardio: vi.fn(),
        deleteCardio: vi.fn(async () => true),
        setCardioField: vi.fn(),
        cancelCardio: vi.fn(),
        saveCardio: vi.fn(async () => true),
    });

    it('serializes duplicate submits and prevents cancel/delete until the save settles', async () => {
        let resolve!: (value: boolean) => void;
        const pending = new Promise<boolean>(r => { resolve = r; });
        const props = { ...activity(), saveCardio: vi.fn(() => pending) };
        const { container } = render(<ActivityCardioSection activity={props} />);
        const form = container.querySelector('form')!;
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(props.saveCardio).toHaveBeenCalledTimes(1);
        expect(form.getAttribute('aria-busy')).toBe('true');
        const cancel = screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement;
        const remove = screen.getByRole('button', { name: /^Elimina / }) as HTMLButtonElement;
        expect(cancel.disabled).toBe(true);
        expect(remove.disabled).toBe(true);
        fireEvent.click(cancel);
        fireEvent.click(remove);
        expect(props.cancelCardio).not.toHaveBeenCalled();
        expect(props.deleteCardio).not.toHaveBeenCalled();
        await act(async () => { resolve(true); await pending; });
        expect(form.getAttribute('aria-busy')).toBe('false');
        fireEvent.click(cancel);
        expect(props.cancelCardio).toHaveBeenCalledTimes(1);
    });

    it('unlocks and allows a retry after an unexpected rejected save', async () => {
        const failure = new Error('synthetic write failure');
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const props = { ...activity(), saveCardio: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(false) };
            const { container } = render(<ActivityCardioSection activity={props} />);
            const form = container.querySelector('form')!;
            fireEvent.submit(form);
            await waitFor(() => expect(log).toHaveBeenCalledWith('Operazione cardio non completata:', failure));
            expect(form.getAttribute('aria-busy')).toBe('false');
            fireEvent.submit(form);
            await waitFor(() => expect(props.saveCardio).toHaveBeenCalledTimes(2));
        } finally {
            log.mockRestore();
        }
    });
});
