import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Exporter } from '../lib/export';

const SettingsView = () => {
    const { userData, saveUserData, logout } = useAuth();
    
    // Fallback in case userData isn't loaded yet
    const profile = userData?.profile || { dob: '', height: '', gender: '' };

    const [dob, setDob] = useState(profile.dob || '');
    const [height, setHeight] = useState(profile.height || '');
    const [gender, setGender] = useState(profile.gender || '');

    const handleSaveProfile = () => {
        const newProfile = { dob, height, gender };
        saveUserData({ ...userData, profile: newProfile });
        alert("Profilo aggiornato!");
    };

    const handleExport = () => {
        if(userData) {
            Exporter.exportToCSV(userData.history || [], userData.nutrition || {});
        }
    };

    return (
        <div id="view-data" className="view-section active">
            <h2>⚙️ Impostazioni</h2>
            
            <div className="card" style={{ border: '1px solid var(--primary-color)' }}>
                <h3 style={{ color: 'var(--primary-color)' }}>Account Google</h3>
                <p style={{ fontSize: '0.8rem' }}>I tuoi dati sono sincronizzati automaticamente sul cloud.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
                    <button className="btn" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={logout}>Esci dall'account</button>
                </div>
            </div>

            <div className="card">
                <h3>Dati Biometrici</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Utilizzati per il calcolo della massa grassa (US Navy).</p>
                <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Data di Nascita</label>
                    <input type="date" style={{ width: '100%', maxWidth: '100%' }} value={dob} onChange={e => setDob(e.target.value)} />
                </div>
                <div className="input-row">
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Altezza (cm)</label>
                        <input type="number" placeholder="es. 180" value={height} onChange={e => setHeight(e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sesso</label>
                        <select value={gender} onChange={e => setGender(e.target.value)}>
                            <option value="">Non Specificato</option>
                            <option value="M">Uomo</option>
                            <option value="F">Donna</option>
                        </select>
                    </div>
                </div>
                <button className="btn btn-primary" style={{ width: '100%', marginTop: '15px' }} onClick={handleSaveProfile}>
                    💾 Salva Profilo
                </button>
            </div>

            <div style={{ marginTop: '40px', marginBottom: '100px' }}>
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: '15px' }} onClick={handleExport}>
                    💾 Esporta Dati (CSV)
                </button>
            </div>
        </div>
    );
};

export default SettingsView;
