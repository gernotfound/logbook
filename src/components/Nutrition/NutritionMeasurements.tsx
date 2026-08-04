import { useNutritionMeasurements } from '../../hooks/useNutritionMeasurements';
import DataMeasurements from '../Data/DataMeasurements';
import DataHistory from '../Data/DataHistory';

/**
 * @deprecated Legacy component kept for backward compatibility and tests.
 * Use DataView / DataMeasurements in new code.
 */
const NutritionMeasurements = () => {
    const {
        profile,
        editingDate,
        measureTime, setMeasureTime,
        weight, setWeight,
        waist, setWaist,
        neck, setNeck,
        hip, setHip,
        manualBf, setManualBf,
        method, setMethod,
        measurementsHistory,
        handleEditClick,
        handleCancelEdit,
        calculateAndSave
    } = useNutritionMeasurements();

    return (
        <div className="nutrition-sub-view active">
            <DataMeasurements 
                profile={profile}
                editingDate={editingDate}
                measureTime={measureTime}
                setMeasureTime={setMeasureTime}
                weight={weight}
                setWeight={setWeight}
                waist={waist}
                setWaist={setWaist}
                neck={neck}
                setNeck={setNeck}
                hip={hip}
                setHip={setHip}
                manualBf={manualBf}
                setManualBf={setManualBf}
                method={method}
                setMethod={setMethod}
                handleCancelEdit={handleCancelEdit}
                calculateAndSave={calculateAndSave}
            />

            <div style={{ marginTop: '20px' }}>
                <DataHistory 
                    measurementsHistory={measurementsHistory}
                    editingDate={editingDate}
                    onSelectEdit={handleEditClick}
                />
            </div>
        </div>
    );
};

export default NutritionMeasurements;
