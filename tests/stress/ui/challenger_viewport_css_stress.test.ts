import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// These are source-level guards, not proof of browser layout. Actual geometry
// is covered by e2e/ui/challenger-chat20-browser-geometry.spec.ts.
describe('Viewport CSS and source conformance', () => {
    const cssPath = path.resolve(__dirname, '../../../src/styles/global.css');
    const globalCss = fs.readFileSync(cssPath, 'utf-8');

    describe('1. Global CSS Architecture & Root Overflow Defense', () => {
        it('1.1: #app-container clips horizontal overflow and stays centered at mobile and desktop widths', () => {
            // Find #app-container block in global.css
            const appContainerMatch = globalCss.match(/#app-container\s*\{([^}]+)\}/);
            expect(appContainerMatch, 'Must define #app-container block in global.css').not.toBeNull();
            
            const content = appContainerMatch![1];
            expect(content).toMatch(/max-width:\s*40rem/);
            expect(content).toMatch(/margin:\s*0\s+auto/);
            expect(content).toMatch(/overflow-x:\s*clip/);
            expect(content).toMatch(/position:\s*relative/);
            expect(content).toMatch(/min-height:\s*100vh/);
            expect(globalCss).toMatch(/@media\s*\(min-width:\s*48rem\)\s*\{\s*#app-container\s*\{\s*max-width:\s*48rem/);
            expect(globalCss).toMatch(/@media\s*\(min-width:\s*64rem\)\s*\{\s*#app-container\s*\{\s*max-width:\s*60rem/);
        });

        it('1.2: .grid-2 uses shrinkable columns and switches to one column at 360px', () => {
            const grid2Match = globalCss.match(/\.grid-2\s*\{([^}]+)\}/);
            expect(grid2Match, 'Must define .grid-2 utility class').not.toBeNull();
            
            const grid2Props = grid2Match![1];
            expect(grid2Props).toMatch(/display:\s*grid/);
            expect(grid2Props).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
            expect(grid2Props).toMatch(/min-width:\s*0/);

            // 22.5rem is 360px at the 16px root size.
            const mediaQueryMatch = globalCss.match(/@media\s*\(max-width:\s*22\.5rem\)\s*\{\s*\.grid-2\s*\{([^}]+)\}/);
            expect(mediaQueryMatch, 'Must define the 360px single-column breakpoint for .grid-2').not.toBeNull();
            expect(mediaQueryMatch![1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        });

        it('1.3: .section-divider and .section-divider-last are defined with proper border, padding and margin', () => {
            const dividerMatch = globalCss.match(/\.section-divider\s*\{([^}]+)\}/);
            expect(dividerMatch).not.toBeNull();
            const dividerProps = dividerMatch![1];
            expect(dividerProps).toMatch(/border-bottom:\s*1px\s+solid\s+var\(--glass-border\)/);
            expect(dividerProps).toMatch(/padding-bottom:\s*1\.5rem/);
            expect(dividerProps).toMatch(/margin-bottom:\s*1\.5rem/);

            const lastDividerMatch = globalCss.match(/\.section-divider-last\s*\{([^}]+)\}/);
            expect(lastDividerMatch).not.toBeNull();
            const lastProps = lastDividerMatch![1];
            expect(lastProps).toMatch(/padding-bottom:\s*1\.5rem/);
            expect(lastProps).toMatch(/margin-bottom:\s*1\.5rem/);
        });

        it('1.4: Universal utility flex classes enforce min-width: 0 to prevent flexbox mobile blowouts', () => {
            const flexClasses = ['.flex', '.flex-col', '.flex-between', '.flex-1', '.flex-2'];
            for (const cls of flexClasses) {
                const escaped = cls.replace('.', '\\.');
                const regex = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`);
                const match = globalCss.match(regex);
                expect(match, `Utility class ${cls} must exist in global.css`).not.toBeNull();
                expect(match![1], `Utility class ${cls} must contain min-width: 0`).toMatch(/min-width:\s*0/);
            }
        });

        it('1.5: Input, select, and textarea rules enforce font-size: 16px !important for Safari iOS zoom defense', () => {
            const inputRules = [...globalCss.matchAll(/input,\s*select,\s*textarea\s*\{([^}]+)\}/g)];
            expect(inputRules.length).toBeGreaterThan(0);
            expect(inputRules.some(rule => /font-size:\s*16px\s*!important/.test(rule[1]))).toBe(true);
        });
    });

    /* =========================================================================
     * SECTION 2: ADVERSARIAL MULTI-ITEM FLEX ROWS & MIN-WIDTH: 0 VERIFICATION
     * ========================================================================= */
    describe('6. Comprehensive Repository-Wide Compliance Audit', () => {
        it('6.1: All spacing and border utility classes exist in global.css', () => {
            const requiredUtilities = [
                '.border-t',
                '.p-15',
                '.pt-10',
                '.pt-15',
                '.pb-10',
                '.pb-15',
                '.mt-15',
                '.mt-20',
                '.mb-20',
                '.gap-15'
            ];

            for (const util of requiredUtilities) {
                const escaped = util.replace('.', '\\.');
                const regex = new RegExp(`${escaped}\\s*\\{`);
                expect(globalCss, `Missing utility class ${util} in global.css`).toMatch(regex);
            }
        });

        it('6.2: refactored views retain visible section separation', () => {
            const filesToCheck = [
                'src/components/Settings/AccountSettingsTab.tsx',
                'src/components/Settings/PrivacySettingsTab.tsx',
                'src/components/Settings/ExportSettingsTab.tsx',
                'src/components/Settings/StorageDiagnostics.tsx',
                'src/components/Training/planning/TrainingPlanning.tsx',
                'src/components/Training/TrainingSessionSetupView.tsx',
                'src/components/Nutrition/NutritionMealsForm.tsx',
                'src/components/Nutrition/NutritionFoodArchiveForm.tsx',
                'src/components/Data/DataMeasurements.tsx',
                'src/components/Data/DataSleep.tsx',
                'src/components/Data/DataBiometry.tsx',
                'src/components/Training/session/SessionExerciseCard.tsx'
            ];

            for (const relPath of filesToCheck) {
                const absPath = path.resolve(__dirname, '../../..', relPath);
                expect(fs.existsSync(absPath), `File ${relPath} must exist`).toBe(true);
                const fileContent = fs.readFileSync(absPath, 'utf-8');
                expect(
                    /section-divider|tracking-panel|settings-system-card|settings-detail-card|settings-detail-list|settings-toggle-card|planning-active-card|planning-cycle-archive/.test(fileContent),
                    `File ${relPath} should utilize a divider or panel surface`
                ).toBe(true);
            }
        });

        it('6.3: No input/select/textarea in src/components declares an inline fontSize < 16px', () => {
            function walkDir(dir: string): string[] {
                let results: string[] = [];
                const list = fs.readdirSync(dir);
                list.forEach(file => {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat && stat.isDirectory()) {
                        results = results.concat(walkDir(fullPath));
                    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
                        results.push(fullPath);
                    }
                });
                return results;
            }

            const allFiles = walkDir(path.resolve(__dirname, '../../../src/components'));
            for (const file of allFiles) {
                const content = fs.readFileSync(file, 'utf-8');
                // Regex looking specifically for <input, <select, or <textarea with inline fontSize < 16px
                const inputTagRegex = /<(?:input|select|textarea)\b[^>]*style=\{\{[^}]*fontSize:\s*['"](?:1[0-5]px|0\.[0-9]+rem)['"][^}]*\}\}[^>]*\/?>/gs;
                const badMatches = content.match(inputTagRegex);
                expect(
                    badMatches,
                    `File ${path.basename(file)} contains dangerous form input fontSize < 16px: ${badMatches?.join(', ')}`
                ).toBeNull();
            }
        });
    });});
