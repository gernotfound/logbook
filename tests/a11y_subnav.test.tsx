import React, { useState } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DataView from '../src/components/Data/DataView';
import NutritionView from '../src/components/Nutrition/NutritionView';
import SettingsView from '../src/components/SettingsView';
import TrainingView from '../src/components/Training/TrainingView';
import { BottomNav } from '../src/components/UI/BottomNav';

// Mock dependencies
vi.mock('../src/store/useAppStore', () => ({
    useAppStore: vi.fn((selector) => {
        const state = {
            userData: { pendingConflicts: {} },
            activeTab: 'home',
            setActiveTab: vi.fn(),
            saveUserData: vi.fn().mockResolvedValue(true)
        };
        return selector(state);
    }),
}));

vi.mock('../src/hooks/useDataMeasurements', () => ({
    useDataMeasurements: () => ({
        profile: {},
        handleEditClick: vi.fn(),
    })
}));

vi.mock('../src/hooks/useDataSleep', () => ({
    useDataSleep: () => ({
        setEditingDate: vi.fn(),
    })
}));

vi.mock('../src/hooks/useAuth', () => ({
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
        expect(tabs.length).toBe(6);
        expect(tabs.map(tab => tab.textContent)).toEqual(['Misurazioni', 'Sonno', 'Attività', 'Contesto', 'Biometria', 'Storico']);
        
        const measurementsTab = tabs[0];
        const sleepTab = tabs[1];
        
        expect(measurementsTab.tagName).toBe('BUTTON');
        expect(measurementsTab.getAttribute('aria-selected')).toBe('true');
        expect(sleepTab.getAttribute('aria-selected')).toBe('false');
        
        // Native button click for Enter/Space
        fireEvent.click(sleepTab);
        expect(measurementsTab.getAttribute('aria-selected')).toBe('false');
        expect(sleepTab.getAttribute('aria-selected')).toBe('true');
    });

    it('NutritionView sub-nav uses buttons with role="tab" and is keyboard accessible', async () => {
        const Wrapper = () => {
            const [subTab, setSubTab] = useState('meals');
            return <NutritionView subTab={subTab as any} setSubTab={setSubTab as any} />;
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
        
        fireEvent.click(planningTab);
        expect(mealsTab.getAttribute('aria-selected')).toBe('false');
        expect(planningTab.getAttribute('aria-selected')).toBe('true');
    });

    it('SettingsView sub-nav uses buttons with role="tab" and is keyboard accessible', async () => {
        render(<SettingsView />);
        
        const tablist = screen.getByRole('tablist', { name: 'Sotto-menu Impostazioni' });
        expect(tablist).not.toBeNull();
        
        const tabs = within(tablist).getAllByRole('tab');
        expect(tabs.length).toBe(4);
        
        const accountTab = tabs[0];
        const privacyTab = tabs[1];
        
        expect(accountTab.tagName).toBe('BUTTON');
        expect(accountTab.getAttribute('aria-selected')).toBe('true');
        
        fireEvent.click(privacyTab);
        expect(accountTab.getAttribute('aria-selected')).toBe('false');
        expect(privacyTab.getAttribute('aria-selected')).toBe('true');
    });

    it('TrainingView sub-nav uses buttons with role="tab" and is keyboard accessible', async () => {
        const Wrapper = () => {
            const [subTab, setSubTab] = useState('session');
            return <TrainingView subTab={subTab} setSubTab={setSubTab} handleEditWorkout={vi.fn()} />;
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
        
        fireEvent.click(planningTab);
        expect(sessionTab.getAttribute('aria-selected')).toBe('false');
        expect(planningTab.getAttribute('aria-selected')).toBe('true');
    });
    
    it('BottomNav uses native buttons correctly', () => {
        render(<BottomNav activeTab="home" setActiveTab={vi.fn()} />);
        const navItems = screen.getAllByRole('button');
        expect(navItems.length).toBe(5);
        expect(navItems[0].getAttribute('aria-label')).toBe('Home');
    });

});
