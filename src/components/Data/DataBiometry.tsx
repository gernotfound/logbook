import { Save, UserRound } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

const DataBiometry = () => {
    const {
        dob, setDob,
        height, setHeight,
        gender, setGender,
        handleSaveProfile
    } = useSettings();

    return (
        <div className="data-page-grid">
            <section className="section-divider-last data-panel" aria-labelledby="biometry-title">
                <div className="data-panel-head">
                    <div>
                        <h2 id="biometry-title" className="data-panel-title">Profilo biometrico</h2>
                        <p>Informazioni usate per il calcolo della composizione corporea.</p>
                    </div>
                    <span className="data-icon-tile" aria-hidden="true"><UserRound size={20} /></span>
                </div>

                <div className="data-form-grid">
                    <label className="data-field data-field-full" htmlFor="biometry-dob">
                        Data di nascita
                        <input
                            id="biometry-dob"
                            type="date"
                            value={dob}
                            onChange={event => setDob(event.target.value)}
                        />
                    </label>

                    <label className="data-field" htmlFor="biometry-height">
                        Altezza
                        <span className="data-input-with-unit">
                            <input
                                id="biometry-height"
                                type="number"
                                inputMode="decimal"
                                min="1"
                                step="0.1"
                                placeholder="Es. 180"
                                value={height}
                                onChange={event => setHeight(event.target.value)}
                                onFocus={event => event.target.select()}
                            />
                            <span className="data-input-unit">cm</span>
                        </span>
                    </label>

                    <label className="data-field" htmlFor="biometry-gender">
                        Sesso
                        <select
                            id="biometry-gender"
                            value={gender}
                            onChange={event => setGender(event.target.value)}
                        >
                            <option value="">Non specificato</option>
                            <option value="M">Uomo</option>
                            <option value="F">Donna</option>
                        </select>
                    </label>
                </div>

                <button type="button" className="btn btn-primary data-full-action" onClick={handleSaveProfile}>
                    <Save size={16} aria-hidden="true" /> Salva profilo biometrico
                </button>
            </section>
        </div>
    );
};

export default DataBiometry;
