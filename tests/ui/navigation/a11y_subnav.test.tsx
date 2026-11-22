import React, { useState } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DataView from '../../../src/components/Data/DataView';
import NutritionView from '../../../src/components/Nutrition/NutritionView';
import TrainingView from '../../../src/components/Training/TrainingView';
import type { NutritionSubTab, TrainingSubTab } from '../../../src/types';

// Mock dependencies
vi.mock('../../../src/store/useAppStore', () => ({
    useAppStore: vi.fn((selector) => {
        const state = {
            userData: { pendingConflicts: {} },
            activeTab: 'home',
            setActiveTab: vi.fn(),
            saveUserData: vi.fn().mockResolvedValue({ ok: true, status: 'synced' })
        };
        return selector(state);
    }),
}));

vi.mock('../../../src/hooks/useAuth', () => ({
    useAuth: () => ({
        currentUser: null,
        isGuest: false,
        logout: vi.fn()
    })
}));

describe('A11Y-01: Keyboard Accessibility for Sub-Navigation', () => {

    it('DataView sub-nav uses buttons with role="tab" and is keyboard accessible', async () => {
        render(<DataView />);
        
        const tablist = screen.getByRole('tablist', { name: 'Sotto-menu Dati' });
        expect(tablist).not.toBeNull();
        
        const tabs = within(tablist).getAllByRole('tab');
        expect(tabs.length).toBe(5);
        expect(tabs.map(tab => tab.textContent)).toEqual(['Misurazioni', 'Sonno', 'Attività', 'Biometria', 'Storico']);
        
        const measurementsTab = tabs[0];
        const sleepTab = tabs[1];
        
        expect(measurementsTab.tagName).toBe('BUTTON');
        expect(measurementsTab.getAttribute('aria-selected')).toBe('true');
        expect(sleepTab.getAttribute('aria-selected')).toBe('false');
        
        measurementsTab.focus();
        fireEvent.keyDown(measurementsTab, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(sleepTab);
        expect(measurementsTab.getAttribute('aria-selected')).toBe('false');
        expect(sleepTab.getAttribute('aria-selected')).toBe('true');
        const panel = screen.getByRole('tabpanel', { name: 'Sonno' });
        expect(sleepTab.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('aria-labelledby')).toBe(sleepTab.id);
        expect(measurementsTab.getAttribute('aria-controls')).toBeNull();
    });

    it('NutritionView sub-nav uses buttons with role="tab" and is keyboard accessible', async () => {
        const Wrapper = () => {
            const [subTab, setSubTab] = useState<NutritionSubTab>('meals');
            return <NutritionView subTab={subTab} setSubTab={setSubTab} />;
        };
        
        render(<Wrapper />);
        
        const tablist = screen.getByRole('tablist', { name: 'Sotto-menu Nutrizione' });
        expect(tablist).not.toBeNull();
        
        const tabs = within(tablist).getAllByRole('tab');
        expect(tabs.length).toBe(5);
        
        const mealsTab = tabs[0];
        const planningTab = tabs[1];
        
        expect(mealsTab.tagName).toBe('BUTTON');
        expect(mealsTab.getAttribute('aria-selected')).toBe('true');
        expect(planningTab.getAttribute('aria-selected')).toBe('false');
        
        mealsTab.focus();
        fireEvent.keyDown(mealsTab, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(planningTab);
        expect(mealsTab.getAttribute('aria-selected')).toBe('false');
        expect(planningTab.getAttribute('aria-selected')).toBe('true');
        const panel = screen.getByRole('tabpanel', { name: 'Pianificazione' });
        expect(planningTab.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('aria-labelledby')).toBe(planningTab.id);
        expect(mealsTab.getAttribute('aria-controls')).toBeNull();
    });

    it('TrainingView sub-nav uses buttons with role="tab" and is keyboard accessible', async () => {
        const Wrapper = () => {
            const [subTab, setSubTab] = useState<TrainingSubTab>('session');
            return <TrainingView subTab={subTab} setSubTab={setSubTab} />;
        };
        render(<Wrapper />);
        
        const tablist = screen.getByRole('tablist', { name: 'Sotto-menu Allenamento' });
        expect(tablist).not.toBeNull();
        
        const tabs = within(tablist).getAllByRole('tab');
        expect(tabs.length).toBe(5);
        
        const sessionTab = tabs[0];
        const planningTab = tabs[1];
        
        expect(sessionTab.tagName).toBe('BUTTON');
        expect(sessionTab.getAttribute('aria-selected')).toBe('true');
        
        sessionTab.focus();
        fireEvent.keyDown(sessionTab, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(planningTab);
        expect(sessionTab.getAttribute('aria-selected')).toBe('false');
        expect(planningTab.getAttribute('aria-selected')).toBe('true');
        const panel = screen.getByRole('tabpanel', { name: 'Pianificazione' });
        expect(planningTab.getAttribute('aria-controls')).toBe(panel.id);
        expect(panel.getAttribute('aria-labelledby')).toBe(planningTab.id);
        expect(sessionTab.getAttribute('aria-controls')).toBeNull();
    });
    


});
