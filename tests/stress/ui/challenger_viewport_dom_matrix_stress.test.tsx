import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';

import { SessionRatings } from '../../../src/components/Training/session/SessionRatings';
import { FoodItemRow } from '../../../src/components/Nutrition/archive/FoodItemRow';
import { CycleEditor } from '../../../src/components/Training/planning/CycleEditor';
import DataBiometryView from '../../../src/components/Data/DataBiometryView';
import { seedViewportStressStore } from './viewportStressStore';

describe('Viewport DOM matrix and planning-grid structure (jsdom)', () => {
    const cssPath = path.resolve(__dirname, '../../../src/styles/global.css');
    const globalCss = fs.readFileSync(cssPath, 'utf-8');

    beforeEach(seedViewportStressStore);
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    describe('4. .grid-2 Media Query Switch & Layout Verification', () => {
        it('4.1: CycleEditor uses the scoped responsive planning grid', () => {
            const { container } = render(
                <CycleEditor
                    routines={[
                        { id: 'r1', name: 'Upper A', exercises: [] }
                    ]}
                    onSave={vi.fn()}
                    onCancel={vi.fn()}
                />
            );

            expect(container.querySelector('.planning-editor-grid')).not.toBeNull();
            const planningCss = fs.readFileSync(
                path.resolve(__dirname, '../../../src/components/Training/planning/planning-redesign.css'),
                'utf-8'
            );
            expect(planningCss).toMatch(/\.planning-editor-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
            expect(planningCss).toMatch(/@media\s*\(max-width:\s*23\.75rem\)[\s\S]*?\.planning-editor-grid\s*\{\s*grid-template-columns:\s*1fr/);
        });

        it('4.2: Utility stylesheet keeps the 360px grid override after wider viewport rules', () => {
            const gridBase = globalCss.indexOf('.grid-2 { display: grid;');
            const narrowOverride = globalCss.search(/@media\s*\(max-width:\s*22\.5rem\)\s*\{\s*\.grid-2\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
            expect(gridBase).toBeGreaterThanOrEqual(0);
            expect(narrowOverride).toBeGreaterThan(gridBase);
        });
    });

    /* =========================================================================
     * SECTION 5: VIEWPORT ADVERSARIAL STRESS MATRIX (320px, 375px, 390px, 430px, Desktop)
     * ========================================================================= */
    describe('5. DOM rendering matrix; actual browser geometry is not exercised', () => {
        const viewports = [
            { name: 'Ultra-Narrow Mobile (iPhone SE 1st gen)', width: 320 },
            { name: 'Compact Mobile (iPhone SE 2nd/3rd gen, 13 mini)', width: 375 },
            { name: 'Standard iOS/Android (iPhone 14/15/16)', width: 390 },
            { name: 'Large Pro Max (iPhone 16 Pro Max, Pixel 8 Pro)', width: 430 },
            { name: 'Desktop Centered (1024px, 1440px)', width: 1024 }
        ];

        for (const vp of viewports) {
            it(`5.x: ${vp.width}px (${vp.name}) mounts accessible controls in jsdom`, () => {
                const wrapper = document.createElement('div');
                wrapper.id = 'app-container';
                wrapper.style.width = `${Math.min(vp.width, 600)}px`;
                wrapper.style.margin = '0 auto';
                wrapper.style.overflowX = 'clip';
                document.body.appendChild(wrapper);

                const { unmount } = render(
                    <div style={{ width: '100%', boxSizing: 'border-box' }}>
                        <SessionRatings
                            water="2.0"
                            setWater={vi.fn()}
                            mood="4"
                            setMood={vi.fn()}
                            pump="5"
                            setPump={vi.fn()}
                            fatigue="4"
                            setFatigue={vi.fn()}
                        />
                        <FoodItemRow
                            food={{ id: 'f1', name: 'Riso basmati', kcal: 350, baseQty: 100, unit: 'g', pro: 7, carbs: 78, fat: 1 }}
                            isLast={true}
                            mealTypes={['Colazione', 'Pranzo', 'Cena', 'Spuntini']}
                            onEdit={vi.fn()}
                            onDelete={vi.fn()}
                    onDuplicate={vi.fn()}
                            onQuickAddToMeal={vi.fn()}
                        />
                        <DataBiometryView />
                    </div>,
                    { container: wrapper }
                );

                expect(wrapper.querySelector('#water-intake')).not.toBeNull();
                expect(wrapper.querySelector('[aria-label="Umore, scala da 1 a 5"]')).not.toBeNull();
                expect(wrapper.querySelector('[aria-label="Pump, scala da 1 a 5"]')).not.toBeNull();
                expect(wrapper.querySelector('[aria-label="Stanchezza, scala da 1 a 5"]')).not.toBeNull();

                unmount();
                document.body.removeChild(wrapper);
            });
        }
    });

    /* =========================================================================
     * SECTION 6: COMPREHENSIVE REPOSITORY-WIDE COMPLIANCE AUDIT
     * ========================================================================= */
});
