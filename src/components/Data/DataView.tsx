import React, { useState } from 'react';
import { useNutritionMeasurements } from '../../hooks/useNutritionMeasurements';
import { useSleepMeasurements } from '../../hooks/useSleepMeasurements';
import DataMeasurements from './DataMeasurements';
import DataBiometry from './DataBiometry';
import DataSleep from './DataSleep';
import DataHistory from './DataHistory';
import type { DataSubTab } from '../../types';
import { useLocalToday } from '../../hooks/useLocalToday';

interface DataViewProps {
    subTab?: DataSubTab;
    setSubTab?: (tab: DataSubTab) => void;
}

const DataView: React.FC<DataViewProps> = ({
    subTab = 'measurements',
    setSubTab
}) => {
    const today = useLocalToday();
    const [chosenDate, setChosenDate] = useState<string | null>(null);
    const selectedDate = chosenDate ?? today;
    const setSelectedDate = (date: string) => setChosenDate(date === today ? null : date);
    const measurementsHook = useNutritionMeasurements(selectedDate);
    const sleepHook = useSleepMeasurements();
    const [localSubTab, setLocalSubTab] = useState<DataSubTab>('measurements');

    const currentSubTab = setSubTab ? subTab : localSubTab;
    const changeSubTab = setSubTab || setLocalSubTab;

    const handleSelectEdit = (day: any) => {
        setSelectedDate(day.date);
        measurementsHook.handleEditClick(day);
        sleepHook.setEditingDate(day.date);
        changeSubTab('measurements');
    };

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
        }
    };

    return (
        <div id="view-data" className="view-section active">
            <div className="sub-nav" role="tablist" aria-label="Sotto-menu Dati" onWheel={handleWheel}>
                <button
                    type="button"
                    role="tab"
                    aria-selected={currentSubTab === 'measurements'}
                    className={`sub-nav-btn ${currentSubTab === 'measurements' ? 'active' : ''}`}
                    onClick={() => changeSubTab('measurements')}
                >
                    Misurazioni
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={currentSubTab === 'sleep'}
                    className={`sub-nav-btn ${currentSubTab === 'sleep' ? 'active' : ''}`}
                    onClick={() => changeSubTab('sleep')}
                >
                    Sonno
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={currentSubTab === 'biometry'}
                    className={`sub-nav-btn ${currentSubTab === 'biometry' ? 'active' : ''}`}
                    onClick={() => changeSubTab('biometry')}
                >
                    Biometria
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={currentSubTab === 'history'}
                    className={`sub-nav-btn ${currentSubTab === 'history' ? 'active' : ''}`}
                    onClick={() => changeSubTab('history')}
                >
                    Storico
                </button>
            </div>

            {currentSubTab === 'measurements' && (
                <div className="data-sub-view active">
                    <DataMeasurements
                        profile={measurementsHook.profile}
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                        targetDateStr={measurementsHook.targetDateStr}
                        editingDate={measurementsHook.editingDate}
                        hasExistingData={measurementsHook.hasExistingData}
                        measureTime={measurementsHook.measureTime}
                        setMeasureTime={measurementsHook.setMeasureTime}
                        weight={measurementsHook.weight}
                        setWeight={measurementsHook.setWeight}
                        waist={measurementsHook.waist}
                        setWaist={measurementsHook.setWaist}
                        neck={measurementsHook.neck}
                        setNeck={measurementsHook.setNeck}
                        hip={measurementsHook.hip}
                        setHip={measurementsHook.setHip}
                        manualBf={measurementsHook.manualBf}
                        setManualBf={measurementsHook.setManualBf}
                        chest={measurementsHook.chest}
                        setChest={measurementsHook.setChest}
                        shoulders={measurementsHook.shoulders}
                        setShoulders={measurementsHook.setShoulders}
                        biceps={measurementsHook.biceps}
                        setBiceps={measurementsHook.setBiceps}
                        thighs={measurementsHook.thighs}
                        setThighs={measurementsHook.setThighs}
                        calves={measurementsHook.calves}
                        setCalves={measurementsHook.setCalves}
                        handleCancelEdit={() => {
                            const wasEditing = !!measurementsHook.editingDate;
                            measurementsHook.handleCancelEdit();
                            if (wasEditing) changeSubTab('history');
                        }}
                        calculateAndSave={async (e) => {
                            const wasEditing = !!measurementsHook.editingDate;
                            const saved = await measurementsHook.calculateAndSave(e);
                            if (wasEditing && saved) changeSubTab('history');
                        }}
                    />
                </div>
            )}

            {currentSubTab === 'biometry' && (
                <div className="data-sub-view active">
                    <DataBiometry />
                </div>
            )}

            {currentSubTab === 'sleep' && (
                <div className="data-sub-view active">
                    <DataSleep
                        sleepHook={sleepHook}
                        selectedDate={sleepHook.selectedDate}
                        setSelectedDate={sleepHook.setSelectedDate}
                        todayDateStr={today}
                    />
                </div>
            )}

            {currentSubTab === 'history' && (
                <div className="data-sub-view active">
                    <DataHistory
                        measurementsHistory={measurementsHook.measurementsHistory}
                        editingDate={measurementsHook.editingDate}
                        onSelectEdit={handleSelectEdit}
                        onDeleteMeasurement={measurementsHook.handleDeleteMeasurement}
                    />
                </div>
            )}
        </div>
    );
};

export default DataView;
