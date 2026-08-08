import React from 'react';
import { Dumbbell, Utensils, Home, Settings, Activity } from 'lucide-react';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const BottomNav: React.FC<BottomNavProps> = React.memo(({ activeTab, setActiveTab }) => (
  <nav
    className="bottom-nav"
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
    <div className="nav-container" role="tablist" aria-label="Sezioni dell'applicazione">
      <button 
        type="button"
        role="tab"
        aria-selected={activeTab === 'home'}
        aria-label="Home"
        className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} 
        onClick={() => setActiveTab('home')}
      >
        <Home size={24} aria-hidden="true" />
        <span>Home</span>
      </button>
      <button 
        type="button"
        role="tab"
        aria-selected={activeTab === 'training'}
        aria-label="Allenamento"
        className={`nav-item ${activeTab === 'training' ? 'active' : ''}`} 
        onClick={() => setActiveTab('training')}
      >
        <Dumbbell size={24} aria-hidden="true" />
        <span>Allenamento</span>
      </button>
      <button 
        type="button"
        role="tab"
        aria-selected={activeTab === 'nutrition'}
        aria-label="Nutrizione"
        className={`nav-item ${activeTab === 'nutrition' ? 'active' : ''}`} 
        onClick={() => setActiveTab('nutrition')}
      >
        <Utensils size={24} aria-hidden="true" />
        <span>Nutrizione</span>
      </button>
      <button 
        type="button"
        role="tab"
        aria-selected={activeTab === 'data'}
        aria-label="Dati e statistiche"
        className={`nav-item ${activeTab === 'data' ? 'active' : ''}`} 
        onClick={() => setActiveTab('data')}
      >
        <Activity size={24} aria-hidden="true" />
        <span>Dati</span>
      </button>
      <button 
        type="button"
        role="tab"
        aria-selected={activeTab === 'settings'}
        aria-label="Impostazioni"
        className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} 
        onClick={() => setActiveTab('settings')}
      >
        <Settings size={24} aria-hidden="true" />
        <span>Impostazioni</span>
      </button>
    </div>
  </nav>
));

export default BottomNav;
