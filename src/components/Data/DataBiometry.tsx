import { Save } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

const DataBiometry = () => {
    const {
        dob, setDob,
        height, setHeight,
        gender, setGender,
        handleSaveProfile
    } = useSettings();

    return (
        <div className="data-form-view">
            <header className="page-header page-header--compact">
                <div>
                    <span className="page-header__eyebrow">Profilo corporeo</span>
                    <h1 className="page-header__title">Dati biometrici</h1>
                    <p className="page-header__description">
                        Questi dati alimentano i calcoli di composizione corporea e restano modificabili in qualsiasi momento.
                    </p>
                </div>
            </header>

            <section className="form-surface">
                <div className="form-grid form-grid--single">
                    <label className="field-stack">
                        <span className="field-label">Data di nascita</span>
                        <input
                            id="biometry-dob"
                            type="date"
                            value={dob}
                            onChange={event => setDob(event.target.value)}
                        />
                    </label>
                </div>

                <div className="form-grid form-grid--two">
                    <label className="field-stack">
                        <span className="field-label">Altezza</span>
                        <span className="field-control-with-unit">
                            <input
                                id="biometry-height"
                                type="number"
                                inputMode="decimal"
                                placeholder="180"
                                value={height}
                                onChange={event => setHeight(event.target.value)}
                                onFocus={event => event.target.select()}
                            />
                            <span className="field-unit">cm</span>
                        </span>
                    </label>

                    <label className="field-stack">
                        <span className="field-label">Sesso</span>
                        <select value={gender} onChange={event => setGender(event.target.value)}>
                            <option value="">Non specificato</option>
                            <option value="M">Uomo</option>
                            <option value="F">Donna</option>
                        </select>
                    </label>
                </div>

                <div className="form-hint">
                    La percentuale di massa grassa calcolata usa la formula US Navy quando sono disponibili le circonferenze necessarie.
                </div>

                <button className="btn btn-primary form-submit" type="button" onClick={handleSaveProfile}>
                    <Save size={18} aria-hidden="true" />
                    Salva profilo biometrico
                </button>
            </section>
        </div>
    );
};

export default DataBiometry;
