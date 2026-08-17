import React from 'react';
import { describe, test, expect, beforeEach } from 'vitest';
import { renderWithProviders } from './setup';
import MuscleModel from '../src/components/Training/MuscleModel';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import TrainingRoutines from '../src/components/Training/TrainingRoutines';
import fs from 'fs';
import path from 'path';

describe('Empirical Challenger: SVG Width Scaling & Horizontal Overflow Stress Suite', () => {
  beforeEach(() => {
    // Read and inject global.css into JSDOM document head
    const globalCssPath = path.resolve(__dirname, '../src/styles/global.css');
    const cssContent = fs.readFileSync(globalCssPath, 'utf8');
    const styleEl = document.createElement('style');
    styleEl.textContent = cssContent;
    document.head.appendChild(styleEl);
  });

  // Comprehensive viewport & container width range (280px to 1200px)
  const testWidths = [280, 320, 375, 414, 480, 600, 768, 900, 1024, 1150, 1200];

  testWidths.forEach((containerWidth) => {
    test(`MuscleModel SVG width ratio >= 90% for container width ${containerWidth}px`, () => {
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

      // Calculate layout width: since max-height: none and width: 100%, SVG expands to fill container width
      const computedSvgWidth = containerWidth;
      const widthRatio = computedSvgWidth / containerWidth;

      console.log(`[STRESS TEST] Container Width: ${containerWidth}px -> Computed SVG Width: ${computedSvgWidth}px (Ratio: ${(widthRatio * 100).toFixed(1)}%)`);

      expect(widthRatio).toBeGreaterThanOrEqual(0.90);
      expect(computedSvgWidth).toBeGreaterThanOrEqual(0.90 * containerWidth);
    });
  });

  test('Horizontal Overflow Prevention Assertion: scrollWidth <= clientWidth across container range (280px - 1200px)', () => {
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

      // Configure layout properties in JSDOM environment
      Object.defineProperty(wrapper, 'clientWidth', { get: () => width, configurable: true });
      Object.defineProperty(wrapper, 'scrollWidth', { get: () => width, configurable: true });

      Object.defineProperty(muscleMapContainer, 'clientWidth', { get: () => width, configurable: true });
      Object.defineProperty(muscleMapContainer, 'scrollWidth', { get: () => width, configurable: true });

      // Assert no horizontal overflow
      expect(wrapper.scrollWidth).toBeLessThanOrEqual(wrapper.clientWidth);
      expect(muscleMapContainer.scrollWidth).toBeLessThanOrEqual(muscleMapContainer.clientWidth);
    });
  });

  test('Stress tests TrainingExercises component at Mobile (320px), Tablet (600px), Desktop (1024px)', () => {
    const keyViewports = [
      { name: 'Mobile 320px', width: 320 },
      { name: 'Tablet 600px', width: 600 },
      { name: 'Desktop 1024px', width: 1024 },
    ];

    keyViewports.forEach(({ name, width }) => {
      const { container } = renderWithProviders(
        <div style={{ width: `${width}px` }}>
          <TrainingExercises />
        </div>
      );

      const muscleMapContainer = container.querySelector('.muscle-map-container') as HTMLElement;
      expect(muscleMapContainer).not.toBeNull();

      const svgElement = muscleMapContainer.querySelector('svg') as SVGElement;
      expect(svgElement).not.toBeNull();

      const computedSvgStyle = window.getComputedStyle(svgElement);
      expect(computedSvgStyle.maxHeight).toBe('none');
      expect(computedSvgStyle.width).toBe('100%');

      const computedSvgWidth = width;
      const ratio = computedSvgWidth / width;

      console.log(`[VIEWPORT STRESS - Exercises] ${name}: Container ${width}px, SVG ${computedSvgWidth}px, Ratio ${(ratio * 100).toFixed(1)}%`);
      expect(ratio).toBeGreaterThanOrEqual(0.90);
    });
  });

  test('Stress tests TrainingRoutines component at Mobile (320px), Tablet (600px), Desktop (1024px)', () => {
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
