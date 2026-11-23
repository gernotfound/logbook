import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataView from '../../../src/components/Data/DataView';
import NutritionView from '../../../src/components/Nutrition/NutritionView';
import { emptyUserData, renderWithAuthenticatedTestOwner } from '../../setup';
import type { DataSubTab, NutritionSubTab } from '../../../src/types';

describe('secondary tab loading', () => {
    it('mounts activity and history panels only after selecting their tabs', async () => {
        function Harness() {
            const [tab, setTab] = useState<DataSubTab>('measurements');
            return <DataView subTab={tab} setSubTab={setTab} />;
        }
        renderWithAuthenticatedTestOwner(<Harness />, { userData: emptyUserData });

        expect(screen.getByRole('tabpanel', { name: 'Misurazioni' })).toBeDefined();
        expect(document.getElementById('data-panel-activity')).toBeNull();
        expect(document.getElementById('data-panel-history')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Attività' }));
        expect(await screen.findByRole('heading', { name: 'Attività — questa settimana' }, { timeout: 5000 })).toBeDefined();
        expect(document.getElementById('data-panel-measurements')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Storico' }));
        expect(await screen.findByRole('heading', { name: 'Storico Dati' })).toBeDefined();
        expect(document.getElementById('data-panel-activity')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Misurazioni' }));
        expect(screen.getByRole('tabpanel', { name: 'Misurazioni' })).toBeDefined();
        expect(document.getElementById('data-panel-history')).toBeNull();
    });

    it('mounts nutrition planning, supplements and archive only when selected', async () => {
        function Harness() {
            const [tab, setTab] = useState<NutritionSubTab>('meals');
            return <NutritionView subTab={tab} setSubTab={setTab} />;
        }
        renderWithAuthenticatedTestOwner(<Harness />, { userData: emptyUserData });

        expect(screen.getByRole('tabpanel', { name: 'Pasti' })).toBeDefined();
        expect(document.getElementById('nutrition-panel-planning')).toBeNull();
        expect(document.getElementById('nutrition-panel-supplements')).toBeNull();
        expect(document.getElementById('nutrition-panel-archive')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Pianificazione' }));
        expect(await screen.findByRole('heading', { name: /Pianificazione macro/i })).toBeDefined();
        expect(document.getElementById('nutrition-panel-meals')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Integratori' }));
        expect(await screen.findByRole('button', { name: /Nuovo integratore/i })).toBeDefined();
        expect(document.getElementById('nutrition-panel-planning')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Alimenti' }));
        expect(await screen.findByRole('heading', { name: /Alimenti/i })).toBeDefined();
        expect(document.getElementById('nutrition-panel-supplements')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Pasti' }));
        expect(screen.getByRole('tabpanel', { name: 'Pasti' })).toBeDefined();
        expect(document.getElementById('nutrition-panel-archive')).toBeNull();
    });
});
