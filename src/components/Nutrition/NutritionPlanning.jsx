import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Logic } from '../../lib/logic';

const NutritionPlanning = () => {
    const { userData, saveUserData } = useAuth();
    
    const [planning, setPlanning] = useState(
        userData?.nutritionPlanning || {
            weight: 80,
            carbsPerKg: 3.5,
            proPerKg: 2.0,
            fatPerKg: 1.0,
            lockedMacro: null,
            chartPeriod: 7,
            normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
        }
    );

    // Calculate current macros based on settings
    // calculateMacrosFromKg returns: { carbsGrams, proGrams, fatGrams, totalKcal, ... }
    const macros = Logic.calculateMacrosFromKg(
        planning.weight, 
        planning.carbsPerKg, 
        planning.proPerKg, 
        planning.fatPerKg
    );
    const totalKcal = macros.totalKcal;

    const handleUpdate = (field, value) => {
        const newPlanning = { ...planning, [field]: value };
        setPlanning(newPlanning);
    };

    const handleSave = () => {
        // Also update normocalorica to match calculated macros so HomeView reflects correctly
        const updatedPlanning = {
            ...planning,
            normocalorica: {
                kcal: macros.totalKcal,
                carbs: macros.carbsGrams,
                pro: macros.proGrams,
                fat: macros.fatGrams,
            }
        };
        setPlanning(updatedPlanning);
        const newUserData = { ...userData, nutritionPlanning: updatedPlanning };
        saveUserData(newUserData);
        alert("Pianificazione salvata sul cloud!");
    };

    return (
        <div className="card planning-target-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0, color: 'var(--text-main)' }}>🎯 Target Calorico & Macro</h3>
            </div>

            <div className="input-row" style={{ marginBottom: '20px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Peso di calcolo (kg)</label>
                    <input 
                        type="number" 
                        value={planning.weight} 
                        onChange={e => handleUpdate('weight', parseFloat(e.target.value) || 0)}
                        style={{ fontSize: '1.2rem', fontWeight: 'bold' }}
                    />
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Target Totale</span>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary-color)' }}>
                        {Math.round(totalKcal) || 0} <span style={{ fontSize: '1rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>kcal</span>
                    </div>
                </div>
            </div>

            <div className="macro-chips-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div className="macro-chip carbs" style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--primary-color)', fontWeight: 'bold' }}>CARBO</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{Math.round(macros.carbsGrams) || 0}g</div>
                </div>
                <div className="macro-chip pro" style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--success-color)', fontWeight: 'bold' }}>PRO</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{Math.round(macros.proGrams) || 0}g</div>
                </div>
                <div className="macro-chip fat" style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.7rem', color: '#f43f5e', fontWeight: 'bold' }}>GRASSI</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{Math.round(macros.fatGrams) || 0}g</div>
                </div>
            </div>

            <h3 style={{ marginTop: '30px', marginBottom: '20px' }}>⚖️ Configurazione Macro per kg</h3>

            <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--primary-color)' }}>Carboidrati</span>
                    <span>{planning.carbsPerKg} g/kg</span>
                </div>
                <input 
                    type="range" min="0" max="10" step="0.1" 
                    value={planning.carbsPerKg} 
                    onChange={e => handleUpdate('carbsPerKg', parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                />
            </div>

            <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--success-color)' }}>Proteine</span>
                    <span>{planning.proPerKg} g/kg</span>
                </div>
                <input 
                    type="range" min="0.5" max="4.0" step="0.1" 
                    value={planning.proPerKg} 
                    onChange={e => handleUpdate('proPerKg', parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                />
            </div>

            <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#f43f5e' }}>Grassi</span>
                    <span>{planning.fatPerKg} g/kg</span>
                </div>
                <input 
                    type="range" min="0.2" max="3.0" step="0.1" 
                    value={planning.fatPerKg} 
                    onChange={e => handleUpdate('fatPerKg', parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                />
            </div>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: '20px' }} onClick={handleSave}>
                💾 Salva Pianificazione
            </button>
        </div>
    );
};

export default NutritionPlanning;
