import { useState, useEffect, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './store/useAppStore';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { analytics } from './lib/firebase';
import { logEvent } from 'firebase/analytics';

import ErrorBoundary from './components/UI/ErrorBoundary';
import BottomNav from './components/UI/BottomNav';
import { GlobalDialog } from './components/UI/GlobalDialog';

const HomeView = lazy(() => import('./components/Home/HomeView'));
const TrainingView = lazy(() => import('./components/Training/TrainingView'));
const NutritionView = lazy(() => import('./components/Nutrition/NutritionView'));
const DataView = lazy(() => import('./components/Data/DataView'));
const SettingsView = lazy(() => import('./components/SettingsView'));

function App() {
  const { currentUser, loading, login } = useAuth();
  const syncing = useAppStore(state => state.syncing);
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('logbook_activeTab') || 'home');
  const [trainingSubTab, setTrainingSubTab] = useState(() => localStorage.getItem('logbook_trainingSubTab') || 'session');
  const [nutritionSubTab, setNutritionSubTab] = useState(() => localStorage.getItem('logbook_nutritionSubTab') || 'meals');
  const [dataSubTab, setDataSubTab] = useState(() => localStorage.getItem('logbook_dataSubTab') || 'measurements');

  useEffect(() => {
    localStorage.setItem('logbook_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('logbook_trainingSubTab', trainingSubTab);
  }, [trainingSubTab]);

  useEffect(() => {
    localStorage.setItem('logbook_nutritionSubTab', nutritionSubTab);
  }, [nutritionSubTab]);

  useEffect(() => {
    localStorage.setItem('logbook_dataSubTab', dataSubTab);
  }, [dataSubTab]);

  // Tracciamento dei tab su Google Analytics (SPA tab tracking)
  useEffect(() => {
    if (analytics) {
      (logEvent as any)(analytics, 'screen_view', {
        screen_name: activeTab,
        screen_class: 'App'
      });
    }
  }, [activeTab]);

  useEffect(() => {
    if (analytics) {
      const subTab = activeTab === 'training' ? trainingSubTab : activeTab === 'nutrition' ? nutritionSubTab : activeTab === 'data' ? dataSubTab : null;
      if (subTab) {
        (logEvent as any)(analytics, 'sub_tab_view', {
          tab: activeTab,
          sub_tab: subTab
        });
      }
    }
  }, [activeTab, trainingSubTab, nutritionSubTab, dataSubTab]);

  // Track visited tabs for lazy Keep-Alive rendering
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>(() => ({ [activeTab]: true }));

  // Preserve and restore scroll position across tabs
  const tabScrollPositions = useState<Record<string, number>>(() => ({}))[0];
  const currentTabRef = useState<{ current: string }>({ current: activeTab })[0];

  const handleTabChange = (newTab: string) => {
    if (newTab === activeTab) return;
    tabScrollPositions[activeTab] = window.scrollY;
    setVisitedTabs(prev => prev[newTab] ? prev : { ...prev, [newTab]: true });
    setActiveTab(newTab);
    currentTabRef.current = newTab;
    requestAnimationFrame(() => {
      const savedPos = tabScrollPositions[newTab] || 0;
      window.scrollTo({ top: savedPos, behavior: 'instant' });
    });
  };

  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  
  // PWA Auto-Update Logic
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r);
      if (r) setSwRegistration(r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && swRegistration) {
        swRegistration.update().catch(err => console.log('SW update check error:', err));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [swRegistration]);

  if (loading) {
    return (
      <div id="auth-overlay">
        <div id="auth-loading" style={{ textAlign: 'center', maxWidth: '400px', padding: '30px', background: 'rgba(30, 41, 59, 0.7)', backdropFilter: 'blur(10px)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)'}}>
            <h1 style={{color:'var(--primary-color)', marginBottom: '10px'}}>LogBook</h1>
            <div className="spinner" style={{margin: '20px auto'}}></div>
            <p>Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div id="auth-overlay">
        <div id="auth-login-box" style={{ textAlign: 'center', maxWidth: '400px', padding: '30px', background: 'rgba(30, 41, 59, 0.7)', backdropFilter: 'blur(10px)', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)'}}>
            <h1 style={{color:'var(--primary-color)', marginBottom: '10px'}}>LogBook</h1>
            <p style={{marginBottom:'30px'}}>Accedi per sincronizzare i tuoi allenamenti sul cloud e renderli disponibili su ogni dispositivo.</p>
            <button id="btn-login-google" className="btn btn-primary" style={{fontSize: '1.1rem', padding: '15px'}} onClick={login}>
                <svg style={{width:'20px', height:'20px', marginRight:'10px', fill:'currentColor'}} viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Accedi con Google
            </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <GlobalDialog />
      {syncing && (
        <div id="sync-overlay">
          <div className="spinner"></div>
          <p style={{fontWeight:'bold', color:'var(--primary-color)'}}>Sincronizzazione in corso...</p>
          <p style={{fontSize:'0.8rem'}}>Attendere, non chiudere l'app.</p>
        </div>
      )}

      {/* PWA Update Prompt */}
      {needRefresh && (
        <div style={{
          position: 'fixed', top: 'calc(15px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--accent-color)', color: '#fff', padding: '12px 16px', borderRadius: '12px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: '12px',
          width: '92%', maxWidth: '420px', boxSizing: 'border-box'
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{fontWeight: 'bold', fontSize: '0.95rem', lineHeight: '1.2'}}>Aggiornamento disponibile!</div>
            <div style={{fontSize: '0.8rem', opacity: 0.9, marginTop: '2px'}}>Ricarica l'app per avere l'ultima versione.</div>
          </div>
          <button 
            className="btn btn-small" 
            style={{background: '#fff', color: 'var(--accent-color)', border: 'none', marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap'}} 
            onClick={() => updateServiceWorker(true)}
          >
            Aggiorna
          </button>
          <button 
            className="btn-icon" 
            style={{color: '#fff', marginLeft: '2px', flexShrink: 0, padding: '4px'}} 
            onClick={() => setNeedRefresh(false)}
          >
            ✕
          </button>
        </div>
      )}

      <main id="app-container">
        {/* Render Active View */}
        <ErrorBoundary>
          <Suspense fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
              <div className="spinner"></div>
              <p style={{ color: 'var(--text-muted)' }}>Caricamento...</p>
            </div>
          }>
            <div style={{ display: activeTab === 'home' ? 'block' : 'none' }}>
              {(visitedTabs.home || activeTab === 'home') && <HomeView onNavigate={handleTabChange} />}
            </div>
            <div style={{ display: activeTab === 'training' ? 'block' : 'none' }}>
              {(visitedTabs.training || activeTab === 'training') && <TrainingView subTab={trainingSubTab} setSubTab={setTrainingSubTab} />}
            </div>
            <div style={{ display: activeTab === 'nutrition' ? 'block' : 'none' }}>
              {(visitedTabs.nutrition || activeTab === 'nutrition') && <NutritionView subTab={nutritionSubTab} setSubTab={setNutritionSubTab} />}
            </div>
            <div style={{ display: activeTab === 'data' ? 'block' : 'none' }}>
              {(visitedTabs.data || activeTab === 'data') && <DataView subTab={dataSubTab} setSubTab={setDataSubTab} />}
            </div>
            <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
              {(visitedTabs.settings || activeTab === 'settings') && <SettingsView />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>

      <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />
    </>
  );
}

export default App;
