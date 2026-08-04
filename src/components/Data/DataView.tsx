import React from 'react';
import { useNutritionMeasurements } from '../../hooks/useNutritionMeasurements';
import DataMeasurements from './DataMeasurements';
import DataBiometry from './DataBiometry';
import DataHistory from './DataHistory';

interface DataViewProps {
    subTab?: string;
    setSubTab?: (tab: string) => void;
}

const DataView: React.FC<DataViewProps> = ({ 
    subTab = 'measurements', 
    setSubTab 
}) => {
    const measurementsHook = useNutritionMeasurements();
    const [localSubTab, setLocalSubTab] = React.useState('measurements');

    const currentSubTab = setSubTab ? subTab : localSubTab;
    const changeSubTab = setSubTab || setLocalSubTab;

    const handleSelectEdit = (day: any) => {
        measurementsHook.handleEditClick(day);
        changeSubTab('measurements');
    };

    return (
        <div id="view-data" className="view-section active">
            <div className="sub-nav">
                <div 
                    className={`sub-nav-btn ${currentSubTab === 'measurements' ? 'active' : ''}`} 
                    onClick={() => changeSubTab('measurements')}
                >
                    Misurazioni
                </div>
                <div 
                    className={`sub-nav-btn ${currentSubTab === 'biometry' ? 'active' : ''}`} 
                    onClick={() => changeSubTab('biometry')}
                >
                    Biometria
                </div>
                <div 
                    className={`sub-nav-btn ${currentSubTab === 'history' ? 'active' : ''}`} 
                    onClick={() => changeSubTab('history')}
                >
                    Storico
                </div>
            </div>

            {currentSubTab === 'measurements' && (
                <div className="data-sub-view active">
                    <DataMeasurements 
                        profile={measurementsHook.profile}
                        editingDate={measurementsHook.editingDate}
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
                        method={measurementsHook.method}
                        setMethod={measurementsHook.setMethod}
                        handleCancelEdit={measurementsHook.handleCancelEdit}
                        calculateAndSave={measurementsHook.calculateAndSave}
                    />
                </div>
            )}

            {currentSubTab === 'biometry' && (
                <div className="data-sub-view active">
                    <DataBiometry />
                </div>
            )}

            {currentSubTab === 'history' && (
                <div className="data-sub-view active">
                    <DataHistory 
                        measurementsHistory={measurementsHook.measurementsHistory}
                        editingDate={measurementsHook.editingDate}
                        onSelectEdit={handleSelectEdit}
                    />
                </div>
            )}
        </div>
    );
};

export default DataView;
