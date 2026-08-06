import { useSettings } from '../../hooks/useSettings';

const DataBiometry = () => {
    const {
        dob, setDob,
        height, setHeight,
        gender, setGender,
        handleSaveProfile
    } = useSettings();

    return (
        <div className="card">
            <h3>Dati Biometrici</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '15px' }}>
                I dati biometrici vengono utilizzati per calcolare accuratamente la percentuale di massa grassa (formula US Navy).
            </p>
            
            <div className="mb-15">
                <label className="text-muted text-xs block mb-4">Data di Nascita</label>
                <input 
                    id="biometry-dob" 
                    type="date" 
                    value={dob} 
                    onChange={e => setDob(e.target.value)} 
                />
            </div>
            
            <div className="input-row" style={{ marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Altezza (cm)</label>
                    <input 
                        id="biometry-height" 
                        type="number" 
                        placeholder="es. 180" 
                        value={height} 
                        onChange={e => setHeight(e.target.value)} 
                        onFocus={e => e.target.select()}
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Sesso</label>
                    <select value={gender} onChange={e => setGender(e.target.value)}>
                        <option value="">Non Specificato</option>
                        <option value="M">Uomo</option>
                        <option value="F">Donna</option>
                    </select>
                </div>
            </div>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={handleSaveProfile}>
                💾 Salva Profilo Biometrico
            </button>
        </div>
    );
};

export default DataBiometry;
