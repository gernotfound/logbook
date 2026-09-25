import { useState } from 'react';
import { useNutritionMeasurements } from '../../hooks/useNutritionMeasurements';
import { useSleepMeasurements } from '../../hooks/useSleepMeasurements';
import DataMeasurements from './DataMeasurements';
import DataBiometry from './DataBiometry';
import DataSleep from './DataSleep';
import DataActivity from './DataActivity';
import DataContext from './DataContext';
import DataHistory from './DataHistory';
import type { DataSubTab } from '../../types';
import { useLocalToday } from '../../hooks/useLocalToday';
import SubNav from '../UI/SubNav';
import './data.css';

const DATA_TABS: ReadonlyArray<{ id: DataSubTab; label: string }> = [
    { id: 'measurements', label: 'Misurazioni' },
    { id: 'sleep', label: 'Sonno' },
    { id: 'activity', label: 'Attività' },
    { id: 'context', label: 'Contesto' },
    { id: 'biometry', label: 'Biometria' },
    { id: 'history', label: 'Storico' }
];

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

    return (
        <div id="view-data" className="view-section active">
            <SubNav
                id="data"
                label="Sotto-menu Dati"
                items={DATA_TABS}
                value={currentSubTab}
                onChange={changeSubTab}
            />

            {currentSubTab === 'measurements' && (
                <div id="data-panel-measurements" role="tabpanel" aria-labelledby="data-tab-measurements" className="data-sub-view active">
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
                <div id="data-panel-biometry" role="tabpanel" aria-labelledby="data-tab-biometry" className="data-sub-view active">
                    <DataBiometry />
                </div>
            )}

            {currentSubTab === 'activity' && (
                <div id="data-panel-activity" role="tabpanel" aria-labelledby="data-tab-activity" className="data-sub-view active">
                    <DataActivity />
                </div>
            )}

            {currentSubTab === 'context' && (
                <div id="data-panel-context" role="tabpanel" aria-labelledby="data-tab-context" className="data-sub-view active">
                    <DataContext />
                </div>
            )}

            {currentSubTab === 'sleep' && (
                <div id="data-panel-sleep" role="tabpanel" aria-labelledby="data-tab-sleep" className="data-sub-view active">
                    <DataSleep
                        sleepHook={sleepHook}
                        selectedDate={sleepHook.selectedDate}
                        setSelectedDate={sleepHook.setSelectedDate}
                        todayDateStr={today}
                    />
                </div>
            )}

            {currentSubTab === 'history' && (
                <div id="data-panel-history" role="tabpanel" aria-labelledby="data-tab-history" className="data-sub-view active">
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
