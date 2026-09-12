import React from 'react';
import { Dumbbell, Utensils, Home, Settings, Activity, type LucideIcon } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const NAV_ITEMS: ReadonlyArray<{ id: string; label: string; icon: LucideIcon; ariaLabel?: string }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'training', label: 'Allenamento', icon: Dumbbell },
  { id: 'nutrition', label: 'Nutrizione', icon: Utensils },
  { id: 'data', label: 'Dati', icon: Activity, ariaLabel: 'Dati e statistiche' },
  { id: 'settings', label: 'Impostazioni', icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = React.memo(({ activeTab, setActiveTab }) => {
  const hasNutritionConflict = useAppStore(state => !!state.userData?.pendingConflicts?.nutritionPlanning);

  return (
    <nav className="bottom-nav safe-bottom" aria-label="Navigazione principale">
      <div className="nav-container" aria-label="Sezioni dell'applicazione">
        {NAV_ITEMS.map(({ id, label, icon: Icon, ariaLabel }) => {
          const isActive = activeTab === id;
          const showConflict = id === 'nutrition' && hasNutritionConflict;

          return (
            <button
              key={id}
              type="button"
              aria-label={ariaLabel ?? label}
              aria-current={isActive ? 'page' : undefined}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={24} aria-hidden="true" />
              {showConflict && (
                <span
                  className="nav-conflict-dot"
                  title="Conflitto nutrizionale pendente"
                  aria-label="Conflitto nutrizionale pendente"
                />
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});

export default BottomNav;
