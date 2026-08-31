import { useState } from 'react';
import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import NutritionPlanning from './NutritionPlanning';
import NutritionMeals from './NutritionMeals';
import NutritionFoodArchive from './NutritionFoodArchive';
import NutritionHistory from './NutritionHistory';
import NutritionSupplements from './NutritionSupplements';
import { useNutritionHistory } from '../../hooks/useNutritionHistory';
import { Logic } from '../../lib/logic';

interface NutritionViewProps {
    subTab?: string;
    setSubTab?: (tab: string) => void;
}

const NutritionView = ({ subTab = 'meals', setSubTab }: NutritionViewProps) => {
    const activeSubTab = (subTab === 'planning' || subTab === 'archive' || subTab === 'history' || subTab === 'supplements') ? subTab : 'meals';
    
    const [selectedDate, setSelectedDate] = useState<string>(Logic.getLocalDateString());
    const mealsHook = useNutritionMeals(selectedDate);
    const historyHook = useNutritionHistory();

    const handleEditFoodFromArchive = (food: any) => {
        mealsHook.startEditCustomFood(food);
        if (setSubTab) {
            setSubTab('meals');
        }
    };

    const handleHistoryDayClick = (dateStr: string) => {
        setSelectedDate(dateStr);
        if (setSubTab) {
            setSubTab('meals');
        }
    };

    const handleWheel = (e: any) => {
        if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
        }
    };

    return (
        <div id="view-nutrition" className="view-section active">
            <div className="sub-nav" onWheel={handleWheel}>
                <div 
                    className={`sub-nav-btn ${activeSubTab === 'meals' ? 'active' : ''}`} 
                    onClick={() => setSubTab && setSubTab('meals')}
                >
                    Pasti
                </div>
                <div 
                    className={`sub-nav-btn ${activeSubTab === 'planning' ? 'active' : ''}`} 
                    onClick={() => setSubTab && setSubTab('planning')}
                >
                    Pianificazione
                </div>
                <div 
                    className={`sub-nav-btn ${activeSubTab === 'supplements' ? 'active' : ''}`} 
                    onClick={() => setSubTab && setSubTab('supplements')}
                >
                    Integratori
                </div>
                <div 
                    className={`sub-nav-btn ${activeSubTab === 'archive' ? 'active' : ''}`} 
                    onClick={() => setSubTab && setSubTab('archive')}
                >
                    Alimenti
                </div>
                <div 
                    className={`sub-nav-btn ${activeSubTab === 'history' ? 'active' : ''}`} 
                    onClick={() => setSubTab && setSubTab('history')}
                >
                    Storico
                </div>
            </div>

            {activeSubTab === 'meals' && (
                <div className="nutrition-sub-view active">
                    <NutritionMeals 
                        mealsHook={{
                            ...mealsHook,
                            saveCustomFood: async () => {
                                const wasEditing = !!mealsHook.editingFoodId;
                                await mealsHook.saveCustomFood();
                                if (wasEditing && setSubTab) setSubTab('archive');
                            },
                            cancelCustomFood: () => {
                                const wasEditing = !!mealsHook.editingFoodId;
                                mealsHook.cancelCustomFood();
                                if (wasEditing && setSubTab) setSubTab('archive');
                            }
                        }}
                        selectedDate={selectedDate} 
                        setSelectedDate={setSelectedDate} 
                    />
                </div>
            )}

            {activeSubTab === 'planning' && (
                <div className="nutrition-sub-view active">
                    <NutritionPlanning />
                </div>
            )}

            {activeSubTab === 'archive' && (
                <div className="nutrition-sub-view active">
                    <NutritionFoodArchive onEditFood={handleEditFoodFromArchive} />
                </div>
            )}

            {activeSubTab === 'history' && (
                <div className="nutrition-sub-view active">
                    <NutritionHistory 
                        nutritionHistory={historyHook.nutritionHistory} 
                        onDayClick={handleHistoryDayClick}
                    />
                </div>
            )}

            {activeSubTab === 'supplements' && (
                <div className="nutrition-sub-view active">
                    <NutritionSupplements 
                        selectedDate={selectedDate} 
                        setSelectedDate={setSelectedDate} 
                    />
                </div>
            )}
        </div>
    );
};

export default NutritionView;
