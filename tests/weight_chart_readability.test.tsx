import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartData, ChartOptions } from 'chart.js';
import WeightChart from '../src/components/Home/WeightChart';
import { useChartAppearance } from '../src/hooks/useChartAppearance';

type RenderedLine = {
    data: ChartData<'line', (number | null)[], string>;
    options: ChartOptions<'line'>;
    role: string;
    'aria-label': string;
};

const lineSpy = vi.hoisted(() => vi.fn((_props: unknown) => {}));

vi.mock('react-chartjs-2', () => ({
    Line: (props: unknown) => {
        lineSpy(props);
        return null;
    },
}));
vi.mock('../src/hooks/useChartAppearance', () => ({
    useChartAppearance: vi.fn(),
}));

function theme(themeName: 'dark' | 'light', reducedMotion = false) {
    const dark = themeName === 'dark';
    return {
        reducedMotion,
        colors: {
            theme: themeName,
            text: dark ? '#f6f7f9' : '#161719',
            muted: dark ? '#a4a9b2' : '#5b626b',
            grid: dark ? '#777780' : '#747b86',
            surface: dark ? '#171719' : '#ffffff',
            primary: dark ? '#00e5ff' : '#006978',
            secondary: '#7934bd',
            warning: '#855200',
            success: '#12653e',
            danger: '#b3263d',
        },
    };
}

function lastLine(): RenderedLine {
    const props = lineSpy.mock.lastCall?.[0];
    if (!props) throw new Error('WeightChart did not render its line chart');
    return props as RenderedLine;
}

describe('WeightChart display contract', () => {
    beforeEach(() => {
        lineSpy.mockClear();
        vi.mocked(useChartAppearance).mockReturnValue(theme('light'));
    });

    it('applies theme tokens to normal and hovered points without mutating source data', () => {
        const chartData = {
            labels: ['01/11', '02/11'],
            datasets: [{
                label: 'Peso corporeo (kg)',
                data: [80.4, null],
                pointHoverBackgroundColor: '#ffffff',
                pointHoverBorderColor: '#38bdf8',
            }],
        };
        const original = JSON.stringify(chartData);
        const view = render(<WeightChart chartData={chartData} />);
        expect(lastLine().data.datasets[0]).toMatchObject({
            data: [80.4, null],
            borderColor: '#006978',
            pointBackgroundColor: '#006978',
            pointBorderColor: '#ffffff',
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: '#006978',
            fill: false,
        });
        expect(JSON.stringify(chartData)).toBe(original);

        vi.mocked(useChartAppearance).mockReturnValue(theme('dark'));
        view.rerender(<WeightChart chartData={chartData} />);
        expect(lastLine().data.datasets[0]).toMatchObject({
            borderColor: '#00e5ff',
            pointHoverBackgroundColor: '#171719',
            pointHoverBorderColor: '#00e5ff',
        });
        expect(JSON.stringify(chartData)).toBe(original);
    });

    it('keeps axis labels at readable size and disables animations for reduced motion', () => {
        vi.mocked(useChartAppearance).mockReturnValue(theme('light', true));
        render(<WeightChart chartData={{ labels: ['01/11'], datasets: [{ data: [80.4] }] }} />);
        const line = lastLine();
        expect(line.options.scales?.x?.ticks?.font).toMatchObject({ size: 12 });
        expect(line.options.scales?.y?.ticks?.font).toMatchObject({ size: 12 });
        expect(line.options.animation).toMatchObject({ duration: 0 });
        expect(line.role).toBe('img');
        expect(line['aria-label']).toBe('Andamento del peso corporeo in chilogrammi');
    });
});
