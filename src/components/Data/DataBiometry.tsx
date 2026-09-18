import { useSettings } from '../../hooks/useSettings';
import { Save } from 'lucide-react';
import '../Nutrition/TrackingViews.css';

const DataBiometry = () => {
    const {
        dob, setDob,
        height, setHeight,
        gender, setGender,
        handleSaveProfile
    } = useSettings();

    return (
        <section className="tracking-panel tracking-view">
            <h1 className="tracking-heading">Dati biometrici</h1>
            <p className="tracking-description">I dati biometrici vengono utilizzati per calcolare la percentuale di massa grassa (formula US Navy).</p>
            <div className="tracking-fields">
                <div className="tracking-field tracking-field--wide">
                    <label htmlFor="biometry-dob">Data di nascita</label>
                    <input id="biometry-dob" type="date" value={dob} onChange={event => setDob(event.target.value)} />
                </div>
                <div className="tracking-field">
                    <label htmlFor="biometry-height">Altezza (cm)</label>
                    <input id="biometry-height" type="number" inputMode="decimal" placeholder="es. 180" value={height} onChange={event => setHeight(event.target.value)} onFocus={event => event.target.select()} />
                </div>
                <div className="tracking-field">
                    <label htmlFor="biometry-gender">Sesso</label>
                    <select id="biometry-gender" value={gender} onChange={event => setGender(event.target.value)}>
                        <option value="">Non specificato</option><option value="M">Uomo</option><option value="F">Donna</option>
                    </select>
                </div>
            </div>
            <button type="button" className="btn btn-primary tracking-full-button" onClick={handleSaveProfile}><Save size={20} aria-hidden="true" /> Salva profilo biometrico</button>
        </section>
    );
};

export default DataBiometry;
