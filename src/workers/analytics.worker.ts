import { computeWeeklyVolumeSeries, computeVolumeCaloriesCorrelation } from '../lib/calc/analytics';

self.onmessage = (e: MessageEvent) => {
    const { id, type, payload } = e.data;

    try {
        if (type === 'CALCULATE_VOLUME_STATS') {
            const { history, library, userWeight, numWeeks, referenceDate } = payload;
            const result = computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, referenceDate);
            self.postMessage({ id, type: 'SUCCESS', result });
        } 
        else if (type === 'CALCULATE_CORRELATION_STATS') {
            const { history, nutrition, library, userWeight, numWeeks, referenceDate } = payload;
            const result = computeVolumeCaloriesCorrelation(history, nutrition, library, userWeight, numWeeks, referenceDate);
            self.postMessage({ id, type: 'SUCCESS', result });
        } 
        else {
            self.postMessage({ id, type: 'ERROR', error: `Unknown task type: ${type}` });
        }
    } catch (error) {
        console.error("Worker error details:", error);
        self.postMessage({ id, type: 'ERROR', error: error instanceof Error ? error.message : 'Unknown error during worker computation' });
    }
};
