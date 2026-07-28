import NutritionMeasurements from './NutritionMeasurements';
import NutritionPlanning from './NutritionPlanning';
import NutritionMeals from './NutritionMeals';

const NutritionView = ({ subTab = 'meals', setSubTab }: any) => {

    return (
        <div id="view-nutrition" className="view-section active">


            <div className="sub-nav">
                <div className={`sub-nav-btn ${subTab === 'meals' ? 'active' : ''}`} onClick={() => setSubTab('meals')}>Pasti</div>
                <div className={`sub-nav-btn ${subTab === 'planning' ? 'active' : ''}`} onClick={() => setSubTab('planning')}>Pianificazione</div>
                <div className={`sub-nav-btn ${subTab === 'measurements' ? 'active' : ''}`} onClick={() => setSubTab('measurements')}>Misurazioni</div>
            </div>

            {subTab === 'meals' && (
                <div className="nutrition-sub-view active">
                    <NutritionMeals />
                </div>
            )}

            {subTab === 'planning' && (
                <div className="nutrition-sub-view active">
                    <NutritionPlanning />
                </div>
            )}

            {subTab === 'measurements' && (
                <div className="nutrition-sub-view active">
                    <NutritionMeasurements />
                </div>
            )}
        </div>
    );
};

export default NutritionView;
