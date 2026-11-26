import { computeWeeklyVolumeSeries, computeVolumeCaloriesCorrelation, computeVolumeCaloriesCorrelationFromVolume } from '../lib/calc/analytics';

// Dedicated Worker: messages arrive through its owning document's private channel.
// Unlike window messages, event.origin is not an authorization check here.
self.onmessage = (e: MessageEvent) => {
    const id = e.data?.id;

    try {
        const { type, payload } = e.data;
        if (type === 'CALCULATE_VOLUME_STATS') {
            const { history, library, userWeight, numWeeks, referenceDate } = payload;
            const result = computeWeeklyVolumeSeries(history, library, userWeight, numWeeks, referenceDate);
            self.postMessage({ id, type: 'SUCCESS', result });
        } 
        else if (type === 'CALCULATE_CORRELATION_FROM_VOLUME') {
            const { volumePoints, nutrition, numWeeks, referenceDate } = payload;
            const result = computeVolumeCaloriesCorrelationFromVolume(volumePoints, nutrition, numWeeks, referenceDate);
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
