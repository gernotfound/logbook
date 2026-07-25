import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';

const NutritionMeasurements = () => {
    const { userData, saveUserData } = useAuth();
    
    // Default form states
    const profile = userData?.profile || {};
    const [weight, setWeight] = useState('');
    const [waist, setWaist] = useState('');
    const [neck, setNeck] = useState('');
    const [hip, setHip] = useState(''); // Solo per donne

    const todayDateStr = new Date().toISOString().split('T')[0];

    const calculateAndSave = () => {
        if (!weight || !waist || !neck || !profile.height || !profile.gender) {
            alert("Compila tutti i campi (incluso altezza e sesso nei Dati Biometrici).");
            return;
        }

        const bf = Logic.calculateBodyFatByMethod('us_navy', {
            gender: profile.gender,
            height: parseFloat(profile.height),
            waist: parseFloat(waist),
            neck: parseFloat(neck),
            hip: hip ? parseFloat(hip) : undefined
        });

        const newNutrition = { ...userData.nutrition };
        if (!newNutrition[todayDateStr]) {
            newNutrition[todayDateStr] = { kcal: 0, carbs: 0, pro: 0, fat: 0 };
        }
        
        newNutrition[todayDateStr].weight = parseFloat(weight);
        newNutrition[todayDateStr].waist = parseFloat(waist);
        newNutrition[todayDateStr].neck = parseFloat(neck);
        if (profile.gender === 'F') newNutrition[todayDateStr].hip = parseFloat(hip);
        newNutrition[todayDateStr].bf = bf;

        saveUserData({ ...userData, nutrition: newNutrition });
        alert(`Misurazione salvata! BF Calcolata: ${bf.toFixed(1)}%`);
    };

    return (
        <div className="card" id="measurement-form-card">
            <h3>📏 Nuova Misurazione</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                Inserisci le circonferenze corporee (a digiuno) per calcolare la Massa Grassa (formula U.S. Navy).
            </p>
            
            <div className="input-row" style={{ marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Peso (kg)</label>
                    <input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vita (cm)</label>
                    <input type="number" step="0.1" value={waist} onChange={e => setWaist(e.target.value)} />
                </div>
            </div>

            <div className="input-row" style={{ marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Collo (cm)</label>
                    <input type="number" step="0.1" value={neck} onChange={e => setNeck(e.target.value)} />
                </div>
                {profile.gender === 'F' && (
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Fianchi (cm)</label>
                        <input type="number" step="0.1" value={hip} onChange={e => setHip(e.target.value)} />
                    </div>
                )}
            </div>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={calculateAndSave}>
                💾 Salva Misurazione
            </button>
        </div>
    );
};

export default NutritionMeasurements;
