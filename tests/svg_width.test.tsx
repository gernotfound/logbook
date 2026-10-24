import React from 'react';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders } from './setup';
import { screen, fireEvent } from '@testing-library/react';
import MuscleModel from '../src/components/Training/MuscleModel';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import fs from 'fs';
import path from 'path';

describe('SVG Muscle Model Layout Width Verification', () => {
  let injectedStyle: HTMLStyleElement;
  beforeEach(() => {
    // Read and inject global.css into JSDOM document head
    const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
    const cssContent = fs.readFileSync(globalCssPath, 'utf8');
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = cssContent;
    document.head.appendChild(injectedStyle);
  });
  afterEach(() => injectedStyle.remove());

  test('verifies max-height constraint is removed from CSS', () => {
    const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
    const cssContent = fs.readFileSync(globalCssPath, 'utf8');
    
    // Ensure .muscle-map-container svg does NOT have max-height: 180px
    const muscleSvgRuleMatch = cssContent.match(/\.muscle-map-container\s+svg\s*\{([^}]+)\}/);
    expect(muscleSvgRuleMatch).not.toBeNull();
    
    const ruleBody = muscleSvgRuleMatch![1];
    expect(ruleBody).not.toContain('max-height: 180px');
    expect(ruleBody).toMatch(/max-height:\s*none/);
  });

  test('checks SVG responsive CSS and model viewBox without simulating layout in jsdom', () => {
    const { container } = renderWithProviders(
      <div style={{ width: '350px' }}>
        <MuscleModel selectedMuscles={['petto']} />
      </div>
    );

    const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
    expect(muscleMapContainer).not.toBeNull();

    const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
    expect(svgElement).not.toBeNull();

    const computedSvgStyle = window.getComputedStyle(svgElement);

    // Verify computed CSS properties
    expect(computedSvgStyle.maxHeight).toBe('none');
    expect(computedSvgStyle.width).toBe('100%');

    // Geometric ratios must use a browser layout engine; see redesign-ux E2E.
    expect(svgElement.getAttribute('viewBox')).toBe('0 0 70 94');
    expect(svgElement.querySelectorAll('path[data-muscle-path]').length).toBeGreaterThan(20);
  });

  test('keeps the full muscle SVG style contract inside TrainingExercises', () => {
    const { container } = renderWithProviders(
      <div style={{ width: '400px' }}>
        <TrainingExercises />
      </div>
    );

    const createBtn = screen.getByRole('button', { name: /Crea esercizio/i });
    fireEvent.click(createBtn);

    const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
    expect(muscleMapContainer).not.toBeNull();

    const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
    expect(svgElement).not.toBeNull();

    const computedSvgStyle = window.getComputedStyle(svgElement);
    expect(computedSvgStyle.maxHeight).toBe('none');

    expect(computedSvgStyle.width).toBe('100%');
    expect(svgElement.getAttribute('viewBox')).toBe('0 0 70 94');
  });

  describe('Adversarial Edge Cases & Stress Tests', () => {
    test('preserves model structure with long exercise names (layout measured in E2E)', () => {
      const longNameUserData = {
        profile: {},
        library: [
          {
            id: 'ex_long',
            name: 'Panca Piana Inclinata Con Manubri A 45 Gradi E Pausa Isometrica In Allungamento Di 3 Secondi SupercalifragilisticexpialidociousWithAnExtremelyLongUnbrokenWordThatMightCauseOverflowProblemsIfCssIsBroken',
            targetMuscle: 'petto',
            muscles: ['petto', 'spalle'],
            secondaryMuscles: ['tricipiti'],
            notes: 'Nota di setup molto lunga per testare la risposta del layout card'
          }
        ],
        routines: [],
        history: [],
        nutrition: {},
        customFoods: [],
        activeWorkout: null,
        nutritionPlanning: {}
      };

      const { container } = renderWithProviders(
        <div style={{ width: '350px' }}>
          <TrainingExercises />
        </div>,
        { userData: longNameUserData }
      );

      const createBtn = screen.getByRole('button', { name: /Crea esercizio/i });
      fireEvent.click(createBtn);

      const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
      expect(muscleMapContainer).not.toBeNull();

      const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
      expect(svgElement).not.toBeNull();

      const computedSvgStyle = window.getComputedStyle(svgElement);
      expect(computedSvgStyle.maxHeight).toBe('none');
      expect(computedSvgStyle.width).toBe('100%');

      expect(svgElement.querySelectorAll('path[data-muscle-path]').length).toBeGreaterThan(20);
    });

    test('handles different muscle selection states (empty, multiple, secondary overlap, invalid IDs)', () => {
      const selectionScenarios = [
        { name: 'empty selection', selected: [], secondary: [] },
        { name: 'single primary', selected: ['petto'], secondary: [] },
        { name: 'multiple primary & secondary', selected: ['petto', 'dorsali', 'quadricipiti'], secondary: ['bicipiti', 'tricipiti', 'spalle'] },
        { name: 'overlapping primary and secondary', selected: ['petto'], secondary: ['petto', 'tricipiti'] },
        { name: 'invalid / unknown muscle IDs', selected: ['non_existent_muscle_123'], secondary: ['unknown_secondary'] },
      ];

      selectionScenarios.forEach((scenario) => {
        const { container } = renderWithProviders(
          <div style={{ width: '350px' }}>
            <MuscleModel selectedMuscles={scenario.selected} secondaryMuscles={scenario.secondary} />
          </div>
        );

        const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
        expect(muscleMapContainer).not.toBeNull();

        const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
        expect(svgElement).not.toBeNull();

        const computedSvgStyle = window.getComputedStyle(svgElement);
        expect(computedSvgStyle.maxHeight).toBe('none');
        expect(computedSvgStyle.width).toBe('100%');

        expect(svgElement.getAttribute('viewBox')).toBe('0 0 70 94');
      });
    });

    test('verifies interactive vs non-interactive mode behavior and DOM styling', () => {
      // Non-interactive mode
      const ignoredToggle = vi.fn();
      const { container: containerNonInteractive } = renderWithProviders(
        <div style={{ width: '350px' }}>
          <MuscleModel selectedMuscles={['petto']} interactive={false} onToggleMuscle={ignoredToggle} />
        </div>
      );
      const muscleMapContainerNonInt = containerNonInteractive.querySelector('.muscle-map-container') as HTMLElement;
      expect(muscleMapContainerNonInt.classList.contains('interactive')).toBe(false);
      const inactiveChest = muscleMapContainerNonInt.querySelector('path[data-muscle-path="chest-lower-left"]');
      expect(inactiveChest).not.toBeNull();
      fireEvent.click(inactiveChest!);
      expect(ignoredToggle).not.toHaveBeenCalled();

      // Interactive mode
      const handleToggle = vi.fn();

      const { container: containerInteractive } = renderWithProviders(
        <div style={{ width: '350px' }}>
          <MuscleModel selectedMuscles={['petto']} interactive={true} onToggleMuscle={handleToggle} />
        </div>
      );
      const muscleMapContainerInt = containerInteractive.querySelector('.muscle-map-container') as HTMLElement;
      expect(muscleMapContainerInt.classList.contains('interactive')).toBe(true);

      const svgElementInt = muscleMapContainerInt.querySelector('svg') as SVGElement;
      const computedSvgStyleInt = window.getComputedStyle(svgElementInt);
      expect(computedSvgStyleInt.maxHeight).toBe('none');
      expect(computedSvgStyleInt.width).toBe('100%');

      const chestPath = svgElementInt.querySelector('path[data-muscle-path="chest-lower-left"]');
      expect(chestPath).not.toBeNull();
      fireEvent.click(chestPath!);
      expect(handleToggle).toHaveBeenCalledTimes(1);
      expect(handleToggle).toHaveBeenCalledWith('chest_lower_left');
    });

    test('verifies no CSS property collisions between index.css and global.css', () => {
      const indexCssPath = path.resolve(__dirname, '../src/index.css');
      const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
      
      if (fs.existsSync(indexCssPath)) {
        const indexCss = fs.readFileSync(indexCssPath, 'utf8');
        // Verify index.css does NOT re-introduce max-height: 180px or fixed width limits
        expect(indexCss).not.toContain('max-height: 180px');
        expect(indexCss).not.toMatch(/\.muscle-map-container\s*svg\s*\{[^}]*max-height:\s*180px/);
      }

      const globalCss = fs.readFileSync(globalCssPath, 'utf8');
      // Verify global.css overrides max-height with none and width with 100%
      expect(globalCss).toMatch(/\.muscle-map-container\s+svg\s*\{[^}]*max-height:\s*none;/);
      expect(globalCss).toMatch(/\.muscle-map-container\s+svg\s*\{[^}]*width:\s*100%;/);
    });
  });
});

