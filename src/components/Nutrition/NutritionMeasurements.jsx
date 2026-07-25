import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';

const NutritionMeasurements = () => {
    const { userData, saveUserData } = useAuth();
    
    const profile = userData?.profile || {};
    const [weight, setWeight] = useState('');
    const [waist, setWaist] = useState('');
    const [neck, setNeck] = useState('');
    const [hip, setHip] = useState(''); // Solo per donne
    const [manualBf, setManualBf] = useState('');
    const [method, setMethod] = useState(profile.gender === 'F' ? 'navy_female' : 'navy_male');

    const todayDateStr = new Date().toISOString().split('T')[0];

    const calculateAndSave = () => {
        if (!weight) {
            alert("Inserisci il peso corporeo.");
            return;
        }

        let bf = null;
        if (method === 'manual') {
            if (!manualBf) { alert("Inserisci la percentuale di massa grassa manuale."); return; }
            bf = parseFloat(manualBf);
        } else {
            if (!waist || !neck || !profile.height) {
                alert("Compila tutti i campi (incluso altezza nei Dati Biometrici).");
                return;
            }
            if (method === 'navy_female' && !hip) {
                alert("Per le donne, inserisci la circonferenza dei fianchi.");
                return;
            }
            // Correct method names: 'navy_male' | 'navy_female'
            bf = Logic.calculateBodyFatByMethod(method, {
                height: parseFloat(profile.height),
                waist: parseFloat(waist),
                neck: parseFloat(neck),
                hip: hip ? parseFloat(hip) : undefined
            });
        }

        if (bf === null || isNaN(bf)) {
            alert("Impossibile calcolare la massa grassa con i dati forniti. Verifica che vita > collo.");
            return;
        }

        const newNutrition = { ...(userData.nutrition || {}) };
        if (!newNutrition[todayDateStr]) {
            newNutrition[todayDateStr] = { kcal: 0, carbs: 0, pro: 0, fat: 0, meals: [] };
        }
        
        newNutrition[todayDateStr].weight = parseFloat(weight);
        if (waist) newNutrition[todayDateStr].waist = parseFloat(waist);
        if (neck) newNutrition[todayDateStr].neck = parseFloat(neck);
        if (hip && profile.gender === 'F') newNutrition[todayDateStr].hip = parseFloat(hip);
        newNutrition[todayDateStr].bf = Math.round(bf * 10) / 10;

        saveUserData({ ...userData, nutrition: newNutrition });
        alert(`Misurazione salvata! BF Calcolata: ${Number(bf).toFixed(1)}%`);
    };

    return (
        <div className="card" id="measurement-form-card">
            <h3>📏 Nuova Misurazione</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Registra il peso e la percentuale di massa grassa.
            </p>
            
            <div style={{ marginBottom: '15px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Metodo calcolo BF</label>
                <select value={method} onChange={e => setMethod(e.target.value)} style={{ width: '100%', padding: '10px', background: 'var(--surface-color)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
                    <option value={profile.gender === 'F' ? 'navy_female' : 'navy_male'}>US Navy (Misurazioni)</option>
                    <option value="manual">Inserimento Manuale</option>
                </select>
            </div>

            <div className="input-row" style={{ marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Peso (kg)</label>
                    <input type="number" step="0.1" placeholder="es. 80.5" value={weight} onChange={e => setWeight(e.target.value)} />
                </div>
                {method === 'manual' ? (
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>BF% Manuale</label>
                        <input type="number" step="0.1" placeholder="es. 15.5" value={manualBf} onChange={e => setManualBf(e.target.value)} />
                    </div>
                ) : (
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vita (cm)</label>
                        <input type="number" step="0.1" value={waist} onChange={e => setWaist(e.target.value)} />
                    </div>
                )}
            </div>

            {method !== 'manual' && (
                <div className="input-row" style={{ marginBottom: '15px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Collo (cm)</label>
                        <input type="number" step="0.1" value={neck} onChange={e => setNeck(e.target.value)} />
                    </div>
                    {(profile.gender === 'F' || method === 'navy_female') && (
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Fianchi (cm)</label>
                            <input type="number" step="0.1" value={hip} onChange={e => setHip(e.target.value)} />
                        </div>
                    )}
                </div>
            )}

            <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={calculateAndSave}>
                💾 Salva Misurazione
            </button>
        </div>
    );
};

export default NutritionMeasurements;
