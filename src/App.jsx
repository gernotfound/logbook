import React, { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import HomeView from './components/Home/HomeView';
import TrainingView from './components/Training/TrainingView';
import NutritionView from './components/Nutrition/NutritionView';
import SettingsView from './components/SettingsView'; 
import { Dumbbell, Utensils, Home, Settings } from 'lucide-react'; 
import { useRegisterSW } from 'virtual:pwa-register/react'; // PWA Update Hook

function App() {
  const { currentUser, loading, syncing, login } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [trainingSubTab, setTrainingSubTab] = useState('session');
  const [nutritionSubTab, setNutritionSubTab] = useState('meals');

  // PWA Auto-Update Logic
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r);
      if (r) {
        // Forza il controllo aggiornamenti ogni volta che l'app torna in primo piano (Cruciale per iOS)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            r.update().catch(err => console.log('SW update check error:', err));
          }
        });
      }
    },
    onRegisterError(error) {
      console.log('SW registration error', error)
    },
  });

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
          position: 'fixed', top: '15px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--accent-color)', color: '#fff', padding: '12px 20px', borderRadius: '12px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: '15px',
          width: '90%', maxWidth: '400px'
        }}>
          <div>
            <div style={{fontWeight: 'bold', fontSize: '0.95rem'}}>Aggiornamento Disponibile!</div>
            <div style={{fontSize: '0.8rem', opacity: 0.9}}>Ricarica l'app per avere l'ultima versione.</div>
          </div>
          <button 
            className="btn btn-small" 
            style={{background: '#fff', color: 'var(--accent-color)', border: 'none', marginLeft: 'auto'}} 
            onClick={() => updateServiceWorker(true)}
          >
            Aggiorna
          </button>
          <button 
            className="btn-icon" 
            style={{color: '#fff', marginLeft: '5px'}} 
            onClick={() => setNeedRefresh(false)}
          >
            ✕
          </button>
        </div>
      )}

      <div id="app-container">
        {/* Render Active View */}
        {activeTab === 'home' && <HomeView onNavigate={setActiveTab} />}
        {activeTab === 'training' && <TrainingView subTab={trainingSubTab} setSubTab={setTrainingSubTab} />}
        {activeTab === 'nutrition' && <NutritionView subTab={nutritionSubTab} setSubTab={setNutritionSubTab} />}
        {activeTab === 'settings' && <SettingsView />}

      </div>
      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <div className="nav-container">
          <div className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>
            <Home size={24} />
            <span>Home</span>
          </div>
          <div className={`nav-item ${activeTab === 'training' ? 'active' : ''}`} onClick={() => setActiveTab('training')}>
            <Dumbbell size={24} />
            <span>Allenamento</span>
          </div>
          <div className={`nav-item ${activeTab === 'nutrition' ? 'active' : ''}`} onClick={() => setActiveTab('nutrition')}>
            <Utensils size={24} />
            <span>Nutrizione</span>
          </div>
          <div className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
            <Settings size={24} />
            <span>Dati</span>
          </div>
        </div>
      </nav>
    </>
  );
}

export default App;
