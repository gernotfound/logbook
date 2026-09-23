import React from 'react';
import { Dumbbell, Utensils, Home, Settings, Activity } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const BottomNav: React.FC<BottomNavProps> = React.memo(({ activeTab, setActiveTab }) => {
  const hasNutritionConflict = useAppStore(state => !!state.userData?.pendingConflicts?.nutritionPlanning);

  return (
    <nav
      className="bottom-nav safe-bottom"
      aria-label="Navigazione principale"
      style={{ position: 'fixed', bottom: 0, left: 0, right: 0, width: '100%', zIndex: 10000 }}
    >
      <div className="nav-container" aria-label="Sezioni dell'applicazione">
        <button
          type="button"
          aria-label="Home"
          aria-current={activeTab === 'home' ? 'page' : undefined}
          className={`nav-item ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => setActiveTab('home')}
        >
          <span className="nav-icon-shell" aria-hidden="true"><Home size={24} /></span>
          <span>Home</span>
        </button>
        <button
          type="button"
          aria-label="Allenamento"
          aria-current={activeTab === 'training' ? 'page' : undefined}
          className={`nav-item ${activeTab === 'training' ? 'active' : ''}`}
          onClick={() => setActiveTab('training')}
        >
          <span className="nav-icon-shell" aria-hidden="true"><Dumbbell size={24} /></span>
          <span>Allenamento</span>
        </button>
        <button
          type="button"
          aria-label="Nutrizione"
          aria-current={activeTab === 'nutrition' ? 'page' : undefined}
          className={`nav-item ${activeTab === 'nutrition' ? 'active' : ''}`}
          onClick={() => setActiveTab('nutrition')}
          style={{ position: 'relative' }}
        >
          <span className="nav-icon-shell" aria-hidden="true"><Utensils size={24} /></span>
          {hasNutritionConflict && (
            <span className="nav-conflict-dot" title="Conflitto nutrizionale pendente" />
          )}
          <span>Nutrizione</span>
        </button>
        <button
          type="button"
          aria-label="Dati e statistiche"
          aria-current={activeTab === 'data' ? 'page' : undefined}
          className={`nav-item ${activeTab === 'data' ? 'active' : ''}`}
          onClick={() => setActiveTab('data')}
        >
          <span className="nav-icon-shell" aria-hidden="true"><Activity size={24} /></span>
          <span>Dati</span>
        </button>
        <button
          type="button"
          aria-label="Impostazioni"
          aria-current={activeTab === 'settings' ? 'page' : undefined}
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <span className="nav-icon-shell" aria-hidden="true"><Settings size={24} /></span>
          <span>Impostazioni</span>
        </button>
      </div>
    </nav>
  );
});

export default BottomNav;
