import { useNutritionMeals } from '../../hooks/useNutritionMeals';
import NutritionPlanning from './NutritionPlanning';
import NutritionMeals from './NutritionMeals';
import NutritionFoodArchive from './NutritionFoodArchive';

interface NutritionViewProps {
    subTab?: string;
    setSubTab?: (tab: string) => void;
}

const NutritionView = ({ subTab = 'meals', setSubTab }: NutritionViewProps) => {
    const activeSubTab = (subTab === 'planning' || subTab === 'archive') ? subTab : 'meals';
    const mealsHook = useNutritionMeals();

    const handleEditFoodFromArchive = (food: any) => {
        mealsHook.startEditCustomFood(food);
        if (setSubTab) {
            setSubTab('meals');
        }
    };

    return (
        <div id="view-nutrition" className="view-section active">
            <div className="sub-nav">
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
                    className={`sub-nav-btn ${activeSubTab === 'archive' ? 'active' : ''}`} 
                    onClick={() => setSubTab && setSubTab('archive')}
                >
                    Alimenti
                </div>
            </div>

            {activeSubTab === 'meals' && (
                <div className="nutrition-sub-view active">
                    <NutritionMeals mealsHook={mealsHook} />
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
        </div>
    );
};

export default NutritionView;
