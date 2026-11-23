import { render, screen } from '@testing-library/react';
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
