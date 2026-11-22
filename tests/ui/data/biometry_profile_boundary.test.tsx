import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({
    setDob: vi.fn(),
    setHeight: vi.fn(),
    setGender: vi.fn(),
    save: vi.fn(),
}));

// Account actions, import/export and deletion are not part of the biometric
// form's render lifecycle. An accidental return to useSettings fails this test.
vi.mock('../../../src/hooks/useSettings', () => ({
    useSettings: () => { throw new Error('Biometry must not mount account/transfer settings hooks.'); },
}));

vi.mock('../../../src/hooks/useSettingsProfile', () => ({
    useSettingsProfile: () => ({
        dob: '2000-01-01',
        setDob: profile.setDob,
        height: '180',
        setHeight: profile.setHeight,
        gender: 'M',
        setGender: profile.setGender,
        handleSaveProfile: profile.save,
    }),
}));

import DataBiometryView from '../../../src/components/Data/DataBiometryView';

describe('biometric profile dependency boundary', () => {
    beforeEach(() => {
        profile.setDob.mockClear();
        profile.setHeight.mockClear();
        profile.setGender.mockClear();
        profile.save.mockClear();
    });

    it('renders and edits through the owner-fenced profile adapter only', () => {
        render(<DataBiometryView />);
        expect((screen.getByLabelText('Data di nascita') as HTMLInputElement).value).toBe('2000-01-01');
        expect((screen.getByLabelText(/^Altezza/) as HTMLInputElement).value).toBe('180');
        expect((screen.getByLabelText(/^Sesso/) as HTMLSelectElement).value).toBe('M');
        fireEvent.change(screen.getByLabelText('Data di nascita'), { target: { value: '2002-03-04' } });
        fireEvent.change(screen.getByLabelText(/^Altezza/), { target: { value: '182' } });
        fireEvent.change(screen.getByLabelText(/^Sesso/), { target: { value: 'F' } });
        expect(profile.setDob).toHaveBeenCalledWith('2002-03-04');
        expect(profile.setHeight).toHaveBeenCalledWith('182');
        expect(profile.setGender).toHaveBeenCalledWith('F');
        fireEvent.click(screen.getByRole('button', { name: 'Salva profilo biometrico' }));
        expect(profile.save).toHaveBeenCalledTimes(1);
    });
});
