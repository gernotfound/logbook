import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { emptyUserData, renderWithProviders } from '../../setup';
import MuscleModel from '../../../src/components/Training/MuscleModel';
import TrainingExercises from '../../../src/components/Training/TrainingExercises';

const MAP_LABEL = 'Mappa dei muscoli, vista anteriore e posteriore';

function musclePath(svg: Element, id: string): SVGElement {
  const path = svg.querySelector<SVGElement>(`path[data-muscle-path="${id}"]`);
  expect(path).not.toBeNull();
  return path!;
}

describe('Muscle map SVG width and editor integration', () => {
  let injectedStyle: HTMLStyleElement;

  beforeEach(() => {
    // The standard test setup expands the global stylesheet's local imports.
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = readFileSync('src/styles/global.css', 'utf8');
    document.head.appendChild(injectedStyle);
  });

  afterEach(() => injectedStyle.remove());

  it('keeps the responsive SVG declarations in the effective stylesheet source', () => {
    const css = readFileSync('src/styles/components.css', 'utf8');
    const rules = [...css.matchAll(/\.muscle-map-container\s+svg\s*\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);

    const declarations = Object.fromEntries(
      [...rules[0][1].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)]
        .map(([, property, value]) => [property, value.trim()]),
    );
    expect(declarations).toMatchObject({
      'max-height': 'none',
      'max-width': '100%',
      width: '100%',
      height: 'auto',
    });
  });

  it('renders a responsive, accessible SVG and highlights actual muscle IDs', () => {
    renderWithProviders(<MuscleModel selectedMuscles={['chest']} secondaryMuscles={['biceps']} />);

    const svg = screen.getByRole('img', { name: MAP_LABEL });
    const style = window.getComputedStyle(svg);
    expect(style.maxHeight).toBe('none');
    expect(style.width).toBe('100%');
    expect(svg.getAttribute('viewBox')).toBe('0 0 70 94');
    expect(svg.querySelectorAll('path[data-muscle-path]').length).toBeGreaterThan(20);

    expect(musclePath(svg, 'chest-lower-left').getAttribute('style'))
      .toContain('fill: var(--primary-color)');
    expect(musclePath(svg, 'biceps-left_1').getAttribute('style'))
      .toContain('fill: var(--accent-color)');
  });

  it('mounts the same SVG contract inside the real exercise editor', () => {
    renderWithProviders(<TrainingExercises />, { userData: emptyUserData });
    fireEvent.click(screen.getByRole('button', { name: 'Crea esercizio' }));

    const editor = screen.getByRole('region', { name: 'Crea esercizio' });
    const svg = within(editor).getByRole('img', { name: MAP_LABEL });
    expect(svg.closest('.muscle-map-container')).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 70 94');
    expect(window.getComputedStyle(svg).maxHeight).toBe('none');
    expect(window.getComputedStyle(svg).width).toBe('100%');
  });

  it('ignores clicks when passive and emits the mapped muscle ID when interactive', () => {
    const onToggle = vi.fn();
    const passive = renderWithProviders(
      <MuscleModel selectedMuscles={['chest']} interactive={false} onToggleMuscle={onToggle} />,
    );
    fireEvent.click(musclePath(screen.getByRole('img', { name: MAP_LABEL }), 'chest-lower-left'));
    expect(onToggle).not.toHaveBeenCalled();
    passive.unmount();

    renderWithProviders(
      <MuscleModel selectedMuscles={['chest']} interactive onToggleMuscle={onToggle} />,
    );
    fireEvent.click(musclePath(screen.getByRole('img', { name: MAP_LABEL }), 'chest-lower-left'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('chest_lower_left');
  });
});
