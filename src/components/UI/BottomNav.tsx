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
    style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      width: '100%',
      zIndex: 10000
    }}
  >
    <div className="nav-container" aria-label="Sezioni dell'applicazione">
      <button
        type="button"
        aria-label="Home"
        className={`nav-item ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => setActiveTab('home')}
      >
        <Home size={24} aria-hidden="true" />
        <span>Home</span>
      </button>
      <button
        type="button"
        aria-label="Allenamento"
        className={`nav-item ${activeTab === 'training' ? 'active' : ''}`}
        onClick={() => setActiveTab('training')}
      >
        <Dumbbell size={24} aria-hidden="true" />
        <span>Allenamento</span>
      </button>
      <button
        type="button"
        aria-label="Nutrizione"
        className={`nav-item ${activeTab === 'nutrition' ? 'active' : ''}`}
        onClick={() => setActiveTab('nutrition')}
        style={{ position: 'relative' }}
      >
        <Utensils size={24} aria-hidden="true" />
        {hasNutritionConflict && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '25%',
              width: '8px',
              height: '8px',
              background: 'var(--warning-color)',
              borderRadius: '50%'
            }}
            title="Conflitto nutrizionale pendente"
          />
        )}
        <span>Nutrizione</span>
      </button>
      <button
        type="button"
        aria-label="Dati e statistiche"
        className={`nav-item ${activeTab === 'data' ? 'active' : ''}`}
        onClick={() => setActiveTab('data')}
      >
        <Activity size={24} aria-hidden="true" />
        <span>Dati</span>
      </button>
      <button
        type="button"
        aria-label="Impostazioni"
        className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => setActiveTab('settings')}
      >
        <Settings size={24} aria-hidden="true" />
        <span>Impostazioni</span>
      </button>
    </div>
  </nav>
  );
});

export default BottomNav;
