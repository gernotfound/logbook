import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { BottomNav } from '../src/components/UI/BottomNav';

describe('BottomNav & Safe Area Layout Conformance', () => {
  const navCss = fs.readFileSync(path.resolve(__dirname, '../src/styles/components.css'), 'utf-8');
  const baseCss = fs.readFileSync(path.resolve(__dirname, '../src/styles/base.css'), 'utf-8');

  it('verifies .bottom-nav has bottom: 0 and does not subtract pixels from env(safe-area-inset-bottom)', () => {
    // Extract .bottom-nav rule block
    const navMatch = navCss.match(/\.bottom-nav\s*\{([^}]+)\}/);
    expect(navMatch).not.toBeNull();
    const navBlock = navMatch![1];

    // Must be anchored flush to bottom: 0
    expect(navBlock).toMatch(/bottom:\s*0\s*!important/);
    expect(navBlock).toMatch(/position:\s*fixed\s*!important/);

    // The complete home-indicator area remains part of the navigation surface.
    expect(navBlock).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)\s*!important/);
  });

  it('verifies body reserves sufficient padding-bottom for the fixed nav bar', () => {
    const bodyMatch = baseCss.match(/body\s*\{([^}]+)\}/);
    expect(bodyMatch).not.toBeNull();
    const bodyBlock = bodyMatch![1];

    expect(bodyBlock).toMatch(/padding:\s*env\(safe-area-inset-top,\s*0px\).*calc\(var\(--nav-height\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*1rem\)/);
  });

  it('renders BottomNav with correct accessibility and tab switching', () => {
    const setActiveTab = vi.fn();
    render(<BottomNav activeTab="home" setActiveTab={setActiveTab} />);

    const tabs = [
      { name: 'Home', id: 'home' },
      { name: 'Allenamento', id: 'training' },
      { name: 'Nutrizione', id: 'nutrition' },
      { name: 'Dati', id: 'data' },
      { name: 'Impostazioni', id: 'settings' },
    ];

    tabs.forEach(({ name, id }) => {
      const btn = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect(btn).not.toBeNull();
      fireEvent.click(btn);
      expect(setActiveTab).toHaveBeenCalledWith(id);
    });
  });
});
