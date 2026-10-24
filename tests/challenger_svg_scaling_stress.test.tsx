import React from 'react';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from './setup';
import MuscleModel from '../src/components/Training/MuscleModel';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import TrainingRoutines from '../src/components/Training/TrainingRoutines';
import fs from 'fs';
import path from 'path';

describe('Empirical Challenger: SVG Width Scaling & Horizontal Overflow Stress Suite', () => {
  let injectedStyle: HTMLStyleElement;
  beforeEach(() => {
    // Read and inject global.css into JSDOM document head
    const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
    const cssContent = fs.readFileSync(globalCssPath, 'utf8');
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = cssContent;
    document.head.appendChild(injectedStyle);
  });
  afterEach(() => {
    injectedStyle.remove();
  });

  // Comprehensive viewport & container width range (280px to 1200px)
  const testWidths = [280, 320, 375, 414, 480, 600, 768, 900, 1024, 1150, 1200];

  testWidths.forEach((containerWidth) => {
    test(`MuscleModel SVG CSS width contract at container width ${containerWidth}px (jsdom smoke)`, () => {
      const { container } = renderWithProviders(
        <div className="card" style={{ width: `${containerWidth}px`, padding: '15px', boxSizing: 'border-box' }}>
          <MuscleModel selectedMuscles={['petto', 'gambe']} />
        </div>
      );

      const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
      expect(muscleMapContainer).not.toBeNull();

      const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
      expect(svgElement).not.toBeNull();

      const computedSvgStyle = window.getComputedStyle(svgElement);

      // Verify strict CSS declarations
      expect(computedSvgStyle.maxHeight).toBe('none');
      expect(computedSvgStyle.width).toBe('100%');
      expect(computedSvgStyle.maxWidth).toBe('100%');

      // jsdom has no layout engine. The CSS contract is observable here; actual
      // occupied width and clipping need an independent browser test.
      expect(svgElement.getAttribute('viewBox')).toBeTruthy();
    });
  });

  test('CSS overflow containment contract across container widths (not measured layout)', () => {
    testWidths.forEach((width) => {
      const { container } = renderWithProviders(
        <div className="card-wrapper" style={{ width: `${width}px`, overflowX: 'hidden' }}>
          <MuscleModel selectedMuscles={['petto']} />
        </div>
      );

      const wrapper = container.querySelector('.card-wrapper') as HTMLElement;
      const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
      expect(wrapper).not.toBeNull();
      expect(muscleMapContainer).not.toBeNull();

      // Do not stub clientWidth/scrollWidth: that would make overflow assertions tautological.
      expect(wrapper.style.width).toBe(`${width}px`);
      expect(wrapper.style.overflowX).toBe('hidden');
      expect(muscleMapContainer.querySelector('svg')).not.toBeNull();
    });
  });

  test('TrainingExercises renders the SVG CSS contract in jsdom at three container widths', () => {
    const keyViewports = [
      { name: 'Mobile 320px', width: 320 },
      { name: 'Tablet 600px', width: 600 },
      { name: 'Desktop 1024px', width: 1024 },
    ];

    keyViewports.forEach(({ width }) => {
      // TrainingExercises intentionally persists creation state in localStorage.
      // Each viewport is an independent scenario, so do not leak that state across iterations.
      localStorage.removeItem('logbook_creating_exercise');
      const rendered = renderWithProviders(
        <div style={{ width: `${width}px` }}>
          <TrainingExercises />
        </div>
      );
      const { container } = rendered;

      try {
        const createBtn = container.querySelector('button.btn-primary');
        expect(createBtn).not.toBeNull();
        fireEvent.click(createBtn!);

        const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
        expect(muscleMapContainer).not.toBeNull();

        const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
        expect(svgElement).not.toBeNull();

        const computedSvgStyle = window.getComputedStyle(svgElement);
        expect(computedSvgStyle.maxHeight).toBe('none');
        expect(computedSvgStyle.width).toBe('100%');

        expect(svgElement.getAttribute('viewBox')).toBeTruthy();
      } finally {
        rendered.unmount();
        localStorage.removeItem('logbook_creating_exercise');
      }
    });
  });

  test('TrainingRoutines CSS smoke at three widths; no layout assertion', () => {
    const keyViewports = [
      { name: 'Mobile 320px', width: 320 },
      { name: 'Tablet 600px', width: 600 },
      { name: 'Desktop 1024px', width: 1024 },
    ];

    keyViewports.forEach(({ width }) => {
      const { container } = renderWithProviders(
        <div style={{ width: `${width}px` }}>
          <TrainingRoutines />
        </div>
      );

      const muscleMapContainer = container.querySelector('.muscle-map-container');
      if (muscleMapContainer) {
        const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
        if (svgElement) {
          const computedSvgStyle = window.getComputedStyle(svgElement);
          expect(computedSvgStyle.maxHeight).toBe('none');
          expect(computedSvgStyle.width).toBe('100%');
        }
      }
    });
  });

  test('Verifies strict absence of max-height: 180px in global.css', () => {
    const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
    const cssContent = fs.readFileSync(globalCssPath, 'utf8');
    
    const muscleSvgRuleMatch = cssContent.match(/\.muscle-map-container\s+svg\s*\{([^}]+)\}/);
    expect(muscleSvgRuleMatch).not.toBeNull();
    
    const ruleBody = muscleSvgRuleMatch![1];
    expect(ruleBody).not.toContain('max-height: 180px');
    expect(ruleBody).toMatch(/max-height:\s*none/);
    expect(ruleBody).toMatch(/width:\s*100%/);
  });
});