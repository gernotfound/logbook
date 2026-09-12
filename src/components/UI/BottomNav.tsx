import React from 'react';
import { Dumbbell, Utensils, Home, Settings, Activity } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const BottomNav: React.FC<BottomNavProps> = React.memo(({ activeTab, setActiveTab }) => {
  const hasNutritionConflict = useAppStore(state => !!state.userData?.pendingConflicts?.nutritionPlanning);

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'training', label: 'Allenamento', icon: Dumbbell },
    { id: 'nutrition', label: 'Nutrizione', icon: Utensils },
    { id: 'data', label: 'Dati', icon: Activity, ariaLabel: 'Dati e statistiche' },
    { id: 'settings', label: 'Impostazioni', icon: Settings },
  ] as const;

  return (
    <nav className="bottom-nav safe-bottom" aria-label="Navigazione principale">
      <div className="nav-container" aria-label="Sezioni dell'applicazione">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const showConflict = item.id === 'nutrition' && hasNutritionConflict;

          return (
            <button
              key={item.id}
              type="button"
              aria-label={'ariaLabel' in item ? item.ariaLabel : item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon size={22} aria-hidden="true" />
              {showConflict && (
                <span
                  className="nav-conflict-dot"
                  title="Conflitto nutrizionale pendente"
                  aria-hidden="true"
                />
              )}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});

export default BottomNav;
