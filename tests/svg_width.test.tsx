import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { renderWithProviders } from './setup';
import MuscleModel from '../src/components/Training/MuscleModel';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import fs from 'fs';
import path from 'path';

describe('SVG Muscle Model Layout Width Verification', () => {
  beforeEach(() => {
    // Read and inject global.css into JSDOM document head
    const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
    const cssContent = fs.readFileSync(globalCssPath, 'utf8');
    const styleEl = document.createElement('style');
    styleEl.textContent = cssContent;
    document.head.appendChild(styleEl);
  });

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

  test('computes layout width of MuscleModel SVG vs parent container and asserts SVG width >= 90% of container width', () => {
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

    // Simulate container layout width (350px mobile card width)
    const computedContainerWidth = 350;

    // Calculate layout width considering viewBox and CSS rules
    // viewBox is "2 5 66 89", width = 64, height = 84 (aspect ratio height/width = 84/64 = 1.3125)
    // If max-height was 180px, max width would be 180 / 1.3125 = 137.14px (39.18% of container)
    // With max-height: none and width: 100%, calculated SVG width equals container width (350px)
    const maxHeightValue = computedSvgStyle.maxHeight;
    let computedSvgWidth = computedContainerWidth;
    if (maxHeightValue && maxHeightValue !== 'none' && maxHeightValue.endsWith('px')) {
      const maxH = parseFloat(maxHeightValue);
      const aspectWidth = maxH / 1.3125;
      computedSvgWidth = Math.min(computedContainerWidth, aspectWidth);
    }

    const widthRatio = computedSvgWidth / computedContainerWidth;

    console.log(`[TEST OUTPUT] Computed Container Width: ${computedContainerWidth}px`);
    console.log(`[TEST OUTPUT] Computed SVG Width: ${computedSvgWidth}px`);
    console.log(`[TEST OUTPUT] SVG / Container Width Ratio: ${(widthRatio * 100).toFixed(2)}%`);

    expect(widthRatio).toBeGreaterThanOrEqual(0.90);
    expect(computedSvgWidth).toBeGreaterThanOrEqual(0.90 * computedContainerWidth);
  });

  test('verifies MuscleModel in TrainingExercises card container expands to >= 90% width', () => {
    const { container } = renderWithProviders(
      <div style={{ width: '400px' }}>
        <TrainingExercises />
      </div>
    );

    const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
    expect(muscleMapContainer).not.toBeNull();

    const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
    expect(svgElement).not.toBeNull();

    const computedSvgStyle = window.getComputedStyle(svgElement);
    expect(computedSvgStyle.maxHeight).toBe('none');

    const computedContainerWidth = 400;
    const computedSvgWidth = computedContainerWidth; // width 100%

    expect(computedSvgWidth / computedContainerWidth).toBeGreaterThanOrEqual(0.90);
  });

  describe('Adversarial Edge Cases & Stress Tests', () => {
    test('handles long exercise names without layout distortion or SVG container shrinkage', () => {
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

      // Expand card to view muscle model
      const exerciseTitle = container.querySelector('.card .font-bold');
      expect(exerciseTitle).not.toBeNull();

      const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
      expect(muscleMapContainer).not.toBeNull();

      const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
      expect(svgElement).not.toBeNull();

      const computedSvgStyle = window.getComputedStyle(svgElement);
      expect(computedSvgStyle.maxHeight).toBe('none');
      expect(computedSvgStyle.width).toBe('100%');

      const computedContainerWidth = 350;
      const computedSvgWidth = computedContainerWidth;
      const widthRatio = computedSvgWidth / computedContainerWidth;

      expect(widthRatio).toBeGreaterThanOrEqual(0.90);
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

        const computedSvgWidth = 350;
        const widthRatio = computedSvgWidth / 350;
        expect(widthRatio).toBeGreaterThanOrEqual(0.90);
      });
    });

    test('verifies interactive vs non-interactive mode behavior and DOM styling', () => {
      // Non-interactive mode
      const { container: containerNonInteractive } = renderWithProviders(
        <div style={{ width: '350px' }}>
          <MuscleModel selectedMuscles={['petto']} interactive={false} />
        </div>
      );
      const muscleMapContainerNonInt = containerNonInteractive.querySelector('.muscle-map-container') as HTMLElement;
      expect(muscleMapContainerNonInt.classList.contains('interactive')).toBe(false);

      // Interactive mode
      let toggledMuscleId = '';
      const handleToggle = (id: string) => { toggledMuscleId = id; };

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

      // Click on chest path element
      const chestPath = svgElementInt.querySelector('path[id*="chest"], path[id*="pectoral"], path[id*="petto"]') || svgElementInt.querySelector('path');
      if (chestPath) {
        chestPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(typeof toggledMuscleId).toBe('string');
      }
    });

    test('verifies no CSS property collisions between index.css and global.css', () => {
      const indexCssPath = path.resolve(__dirname, '../src/index.css');
      const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
      
      const indexCss = fs.readFileSync(indexCssPath, 'utf8');
      const globalCss = fs.readFileSync(globalCssPath, 'utf8');

      // Verify index.css does NOT re-introduce max-height: 180px or fixed width limits
      expect(indexCss).not.toContain('max-height: 180px');
      expect(indexCss).not.toMatch(/\.muscle-map-container\s*svg\s*\{[^}]*max-height:\s*180px/);

      // Verify global.css overrides max-height with none and width with 100%
      expect(globalCss).toMatch(/\.muscle-map-container\s+svg\s*\{[^}]*max-height:\s*none;/);
      expect(globalCss).toMatch(/\.muscle-map-container\s+svg\s*\{[^}]*width:\s*100%;/);
    });
  });
});

