import React from 'react';
import { screen } from '@testing-library/react';
import { BufferedInput, BufferedTextarea } from '../../../src/components/UI/BufferedInput';
import { deviceKey } from '../../../src/lib/sync/deviceStorage';
import { captureSession } from '../../../src/lib/sync/session';
import { localStorageMock } from '../../setup';

type FieldKind = 'input' | 'textarea';
export const initialGetItem = localStorageMock.getItem.getMockImplementation()!;
export const initialSetItem = localStorageMock.setItem.getMockImplementation()!;

export function field(kind: FieldKind, onChange: (value: string) => void, value = '') {
    return kind === 'input'
        ? <BufferedInput id="stable-draft" type="text" inputMode="decimal" value={value} onChange={onChange} aria-label="Bozza workout" />
        : <BufferedTextarea id="stable-draft" value={value} onChange={onChange} aria-label="Bozza workout" />;
}

export function recoveryKey(kind: FieldKind) {
    return deviceKey(`draft:buffered:${kind}:stable-draft`, captureSession().owner);
}

export function editor() {
    return screen.getByRole('textbox', { name: 'Bozza workout' }) as HTMLInputElement | HTMLTextAreaElement;
}
