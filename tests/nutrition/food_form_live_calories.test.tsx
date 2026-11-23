import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CustomFoodForm from '../../src/components/Nutrition/CustomFoodForm';
import { emptyCustomFoodDraft, type CustomFoodDraft } from '../../src/lib/nutrition/customFoodDraft';

function renderFoodForm(
    initial: Partial<CustomFoodDraft> = {},
    onSave: () => Promise<void | boolean> = async () => true,
) {
    function Harness() {
        const [draft, setDraft] = useState<CustomFoodDraft>({
            ...emptyCustomFoodDraft(),
            name: 'Test alimento',
            ...initial,
        });
        return (
            <CustomFoodForm
                cfData={draft}
                setCfData={setDraft}
                saveCustomFood={onSave}
                showCustomModal
                setShowCustomModal={vi.fn()}
            />
        );
    }
    return render(<Harness />);
}

describe('CustomFoodForm — calories and edit lifecycle', () => {
    it('recalculates after each macro edit but leaves a manually supplied kcal value editable', () => {
        renderFoodForm();
        const carbs = screen.getByLabelText('Carbo (g)');
        const protein = screen.getByLabelText('Pro (g)');
        const fat = screen.getByLabelText('Grassi (g)');
        const kcal = screen.getByLabelText('Kcal') as HTMLInputElement;

        fireEvent.change(carbs, { target: { value: '10' } });
        expect(kcal.value).toBe('40');
        fireEvent.change(protein, { target: { value: '10' } });
        expect(kcal.value).toBe('80');
        fireEvent.change(fat, { target: { value: '10' } });
        expect(kcal.value).toBe('170');
        fireEvent.change(kcal, { target: { value: '165' } });
        expect(kcal.value).toBe('165');
    });

    it('rounds the real form preview for mixed decimal macros', () => {
        renderFoodForm();
        fireEvent.change(screen.getByLabelText('Carbo (g)'), { target: { value: '33.5' } });
        fireEvent.change(screen.getByLabelText('Pro (g)'), { target: { value: '18.2' } });
        fireEvent.change(screen.getByLabelText('Grassi (g)'), { target: { value: '7.8' } });
        expect((screen.getByLabelText('Kcal') as HTMLInputElement).value).toBe('277');
    });

    it('displays prefilled numeric nutrients and does not save merely by editing them', async () => {
        const save = vi.fn(async () => true);
        renderFoodForm({ name: 'Pasta integrale', carbs: 65, pro: 12, fat: 2, kcal: 326 }, save);
        expect((screen.getByLabelText('Carbo (g)') as HTMLInputElement).value).toBe('65');
        expect((screen.getByLabelText('Pro (g)') as HTMLInputElement).value).toBe('12');
        expect((screen.getByLabelText('Grassi (g)') as HTMLInputElement).value).toBe('2');
        fireEvent.change(screen.getByLabelText('Carbo (g)'), { target: { value: '70' } });
        expect((screen.getByLabelText('Kcal') as HTMLInputElement).value).toBe('346');
        expect(save).not.toHaveBeenCalled();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Salva alimento' }));
        });
        expect(save).toHaveBeenCalledOnce();
    });

    it('submits once while pending and retains the draft after a rejected save', async () => {
        let finish!: (saved: boolean) => void;
        const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
        renderFoodForm({
            name: 'Riso', kcal: '100', carbs: '10', pro: '10', fat: '2',
        }, save);

        const submit = screen.getByRole('button', { name: 'Salva alimento' }) as HTMLButtonElement;
        fireEvent.click(submit);
        fireEvent.click(submit);
        expect(save).toHaveBeenCalledOnce();
        expect(submit.disabled).toBe(true);
        expect((screen.getByLabelText('Nome alimento *') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => finish(false));
        expect(submit.disabled).toBe(false);
        expect((screen.getByLabelText('Nome alimento *') as HTMLInputElement).value).toBe('Riso');

        fireEvent.click(submit);
        expect(save).toHaveBeenCalledTimes(2);
        await act(async () => finish(true));
    });

    it('keeps the form editable and permits retry after the save promise rejects', async () => {
        const rejection = new Error('storage unavailable');
        const save = vi.fn()
            .mockRejectedValueOnce(rejection)
            .mockResolvedValueOnce(true);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            renderFoodForm({ name: 'Riso', kcal: '100', carbs: '10', pro: '10', fat: '2' }, save);
            const submit = screen.getByRole('button', { name: 'Salva alimento' }) as HTMLButtonElement;

            fireEvent.click(submit);
            await waitFor(() => expect(submit.disabled).toBe(false));
            expect(save).toHaveBeenCalledOnce();
            expect((screen.getByLabelText('Nome alimento *') as HTMLInputElement).value).toBe('Riso');
            expect((screen.getByLabelText('Kcal') as HTMLInputElement).value).toBe('100');
            expect(log).toHaveBeenCalledWith('Salvataggio alimento non completato:', rejection);

            fireEvent.click(submit);
            await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
        } finally {
            log.mockRestore();
        }
    });
});
