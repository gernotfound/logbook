import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExportSelector, type ExportSelection } from '../src/components/ExportSelector';
import { buildShareExportData } from '../src/lib/export';
import type { UserData } from '../src/types';

const makeData = (): UserData => ({
    library: [
        { id: 'ex-1', name: 'Squat', setsCount: 3, sets: [] },
        { id: 'ex-2', name: 'Panca piana', setsCount: 3, sets: [] },
        { id: 'ex-3', name: 'Rematore', setsCount: 3, sets: [] },
    ],
    routines: [
        { id: 'r-1', name: 'A', exercises: [{ exId: 'ex-1', setsCount: 3 }, { exId: 'ex-2', setsCount: 3 }] },
        { id: 'r-2', name: 'B', exercises: [{ exId: 'ex-3', setsCount: 3 }] },
    ],
    trainingCycles: [
        { id: 'c-1', name: 'Ciclo forza', durationWeeks: 4, routines: [{ routineId: 'r-1', frequencyPerWeek: 2 }] },
    ],
});

describe('granular share export', () => {
    it('resolves cycle dependencies transitively without exporting unrelated entities', () => {
        const result = buildShareExportData(makeData(), {
            exportLibrary: false,
            exportRoutines: false,
            exportTrainingCycles: ['c-1'],
        });

        expect(result.trainingCycles.map(item => item.id)).toEqual(['c-1']);
        expect(result.routines.map(item => item.id)).toEqual(['r-1']);
        expect(result.library.map(item => item.id)).toEqual(['ex-1', 'ex-2']);
    });

    it('deduplicates explicit selections and ignores unknown selected ids', () => {
        const result = buildShareExportData(makeData(), {
            exportLibrary: ['ex-3', 'ex-3', 'missing-exercise'],
            exportRoutines: ['r-2', 'r-2', 'missing-routine'],
            exportTrainingCycles: false,
        });

        expect(result.library.map(item => item.id)).toEqual(['ex-3']);
        expect(result.routines.map(item => item.id)).toEqual(['r-2']);
        expect(result.trainingCycles).toEqual([]);
    });

    it('removes dangling nested references when the source data is inconsistent', () => {
        const data = makeData();
        data.routines = [{ id: 'r-bad', name: 'Incompleta', exercises: [{ exId: 'missing', setsCount: 3 }] }];
        data.trainingCycles = [{ id: 'c-bad', name: 'Ciclo incompleto', durationWeeks: 4, routines: [
            { routineId: 'r-bad', frequencyPerWeek: 1 },
            { routineId: 'missing-routine', frequencyPerWeek: 1 },
        ] }];

        const result = buildShareExportData(data, {
            exportLibrary: false,
            exportRoutines: false,
            exportTrainingCycles: ['c-bad'],
        });

        expect(result.routines).toEqual([{ id: 'r-bad', name: 'Incompleta', exercises: [] }]);
        expect(result.trainingCycles[0].routines).toEqual([{ routineId: 'r-bad', frequencyPerWeek: 1 }]);
        expect(result.library).toEqual([]);
    });
});

describe('ExportSelector', () => {
    it('supports fuzzy search and checkbox selection', () => {
        const items = [
            { id: '1', name: 'Squat con bilanciere' },
            { id: '2', name: 'Panca piana' },
            { id: '3', name: 'Stacco rumeno' },
            { id: '4', name: 'Military press' },
            { id: '5', name: 'Lat machine' },
            { id: '6', name: 'Curl manubri' },
        ];
        let selection: ExportSelection = 'all';
        const onChange = vi.fn((value: ExportSelection) => { selection = value; });
        const { rerender } = render(<ExportSelector title="Esercizi" items={items} selection={selection} onChange={onChange} />);

        fireEvent.change(screen.getByLabelText('Modalità selezione Esercizi'), { target: { value: 'custom' } });
        expect(onChange).toHaveBeenLastCalledWith([]);
        rerender(<ExportSelector title="Esercizi" items={items} selection={selection} onChange={onChange} />);

        fireEvent.change(screen.getByLabelText('Cerca in Esercizi'), { target: { value: 'squat' } });
        const squat = screen.getByLabelText('Squat con bilanciere');
        expect(squat).not.toBeNull();
        expect(screen.queryByLabelText('Panca piana')).toBeNull();

        fireEvent.click(squat);
        expect(onChange).toHaveBeenLastCalledWith(['1']);
    });
});
