import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataView from '../../src/components/Data/DataView';
import NutritionView from '../../src/components/Nutrition/NutritionView';
import { emptyUserData, renderWithAuthenticatedTestOwner } from '../setup';
import type { DataSubTab, NutritionSubTab } from '../../src/types';

describe('secondary tab loading', () => {
    it('loads activity and history through tab navigation without manually importing the view', async () => {
        function Harness() {
            const [tab, setTab] = useState<DataSubTab>('measurements');
            return <DataView subTab={tab} setSubTab={setTab} />;
        }
        renderWithAuthenticatedTestOwner(<Harness />, { userData: emptyUserData });

        expect(screen.getByRole('tabpanel', { name: 'Misurazioni' })).toBeDefined();
        fireEvent.click(screen.getByRole('tab', { name: 'Attività' }));
        expect(await screen.findByRole('heading', { name: 'Attività — questa settimana' }, { timeout: 5000 })).toBeDefined();
        fireEvent.click(screen.getByRole('tab', { name: 'Storico' }));
        expect(await screen.findByRole('heading', { name: 'Storico Dati' })).toBeDefined();
        fireEvent.click(screen.getByRole('tab', { name: 'Misurazioni' }));
        expect(screen.getByRole('tabpanel', { name: 'Misurazioni' })).toBeDefined();
    });

    it('loads nutrition planning, supplements and archive only when selected', async () => {
        function Harness() {
            const [tab, setTab] = useState<NutritionSubTab>('meals');
            return <NutritionView subTab={tab} setSubTab={setTab} />;
        }
        renderWithAuthenticatedTestOwner(<Harness />, { userData: emptyUserData });

        expect(screen.getByRole('tabpanel', { name: 'Pasti' })).toBeDefined();
        fireEvent.click(screen.getByRole('tab', { name: 'Pianificazione' }));
        expect(await screen.findByRole('heading', { name: /Pianificazione macro/i })).toBeDefined();
        fireEvent.click(screen.getByRole('tab', { name: 'Integratori' }));
        expect(await screen.findByRole('button', { name: /Nuovo integratore/i })).toBeDefined();
        fireEvent.click(screen.getByRole('tab', { name: 'Alimenti' }));
        expect(await screen.findByRole('heading', { name: /Alimenti/i })).toBeDefined();
        fireEvent.click(screen.getByRole('tab', { name: 'Pasti' }));
        expect(screen.getByRole('tabpanel', { name: 'Pasti' })).toBeDefined();
    });
});
