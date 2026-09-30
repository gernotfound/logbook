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
    const navMatch = navCss.match(/\.bottom-nav\s*\{([^}]+)\}/);
    expect(navMatch).not.toBeNull();
    const navBlock = navMatch![1];
    expect(navBlock).toMatch(/bottom:\s*0\s*!important/);
    expect(navBlock).toMatch(/position:\s*fixed\s*!important/);
    expect(navBlock).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)\s*!important/);
  });

  it('verifies body reserves sufficient padding-bottom for the fixed nav bar', () => {
    const bodyMatch = baseCss.match(/body\s*\{([^}]+)\}/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch![1]).toMatch(/padding:\s*env\(safe-area-inset-top,\s*0px\).*calc\(var\(--nav-height\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*1rem\)/);
  });

  it('uses one deterministic icon highlight layer and clears it when the active tab changes', () => {
    const setActiveTab = vi.fn();
    const { container, rerender } = render(<BottomNav activeTab="home" setActiveTab={setActiveTab} />);
    expect(container.querySelectorAll('.nav-icon-shell')).toHaveLength(4);
    expect(container.querySelectorAll('.nav-item.active')).toHaveLength(1);
    rerender(<BottomNav activeTab="data" setActiveTab={setActiveTab} />);
    expect(container.querySelectorAll('.nav-item.active')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Dati/i }).classList.contains('active')).toBe(true);
    expect(navCss).toMatch(/\.nav-item\.active\s+\.nav-icon-shell\s*\{/);
    expect(navCss).not.toMatch(/\.nav-item\.active\s+svg\s*\{[^}]*background/);
  });

  it('renders the four primary destinations with correct switching', () => {
    const setActiveTab = vi.fn();
    render(<BottomNav activeTab="home" setActiveTab={setActiveTab} />);
    const tabs = [
      { name: 'Home', id: 'home' },
      { name: 'Allenamento', id: 'training' },
      { name: 'Nutrizione', id: 'nutrition' },
      { name: 'Dati', id: 'data' },
    ];
    tabs.forEach(({ name, id }) => {
      const btn = screen.getByRole('button', { name: new RegExp(name, 'i') });
      fireEvent.click(btn);
      expect(setActiveTab).toHaveBeenCalledWith(id);
    });
    expect(screen.queryByRole('button', { name: 'Impostazioni' })).toBeNull();
  });
});
