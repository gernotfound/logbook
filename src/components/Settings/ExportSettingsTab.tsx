import type { ChangeEvent } from 'react';
import { Save } from 'lucide-react';
import { ExportSelector, type ExportSelection, type ExportSelectorItem } from '../ExportSelector';
import type { ImportMode } from '../../lib/backup';

const EMPTY_EXPORT_ITEMS: ExportSelectorItem[] = [];

type ExportShareOptions = {
    exportLibrary?: boolean | string[];
    exportRoutines?: boolean | string[];
    exportTrainingCycles?: boolean | string[];
};

interface ExportSettingsTabProps {
    library?: ExportSelectorItem[];
    routines?: ExportSelectorItem[];
    trainingCycles?: ExportSelectorItem[];
    exportLibrary: ExportSelection;
    exportRoutines: ExportSelection;
    exportTrainingCycles: ExportSelection;
    onLibrarySelectionChange: (value: ExportSelection) => void;
    onRoutinesSelectionChange: (value: ExportSelection) => void;
    onTrainingCyclesSelectionChange: (value: ExportSelection) => void;
    onExportShare: (options?: ExportShareOptions) => void | Promise<void>;
    onExportBackup: () => void | Promise<void>;
    onExportCSV: () => void;
    onImportFile: (event: ChangeEvent<HTMLInputElement>, mode?: ImportMode) => void | Promise<void>;
    importingData: boolean;
    exportingData: boolean;
}

export function ExportSettingsTab({
    library,
    routines,
    trainingCycles,
    exportLibrary,
    exportRoutines,
    exportTrainingCycles,
    onLibrarySelectionChange,
    onRoutinesSelectionChange,
    onTrainingCyclesSelectionChange,
    onExportShare,
    onExportBackup,
    onExportCSV,
    onImportFile,
    importingData,
    exportingData,
}: ExportSettingsTabProps) {
    const noShareSelection = exportLibrary === 'none' && exportRoutines === 'none' && exportTrainingCycles === 'none';

    return (
        <>
            <div className="section-divider">
                <h3 style={{margin: '0 0 10px 0',color: 'var(--text-main)'}}><span aria-hidden="true">🤝</span> Condividi con altri atleti</h3>
                <p style={{ margin: '0 0 15px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Esporta o importa Esercizi, Schede e Pianificazioni per condividerli.</p>

                <ExportSelector title="Esercizi (Libreria)" items={library || EMPTY_EXPORT_ITEMS} selection={exportLibrary} onChange={onLibrarySelectionChange} />
                <ExportSelector title="Schede (Routines)" items={routines || EMPTY_EXPORT_ITEMS} selection={exportRoutines} onChange={onRoutinesSelectionChange} />
                <ExportSelector title="Pianificazioni (Cicli)" items={trainingCycles || EMPTY_EXPORT_ITEMS} selection={exportTrainingCycles} onChange={onTrainingCyclesSelectionChange} />

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        className="btn"
                        style={{ flex: 1, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', margin: 0, opacity: noShareSelection ? 0.5 : 1 }}
                        onClick={() => onExportShare({
                            exportLibrary: exportLibrary === 'all' ? true : exportLibrary === 'none' ? false : exportLibrary,
                            exportRoutines: exportRoutines === 'all' ? true : exportRoutines === 'none' ? false : exportRoutines,
                            exportTrainingCycles: exportTrainingCycles === 'all' ? true : exportTrainingCycles === 'none' ? false : exportTrainingCycles
                        })}
                        disabled={noShareSelection}
                    >
                        <span aria-hidden="true">📤</span> Esporta JSON
                    </button>
                    <label className="btn btn-primary" style={{ flex: 1, margin: 0, textAlign: 'center', cursor: 'pointer', opacity: importingData ? 0.7 : 1 }}>
                        {importingData ? <span aria-hidden="true">⏳</span> : <span aria-hidden="true">📥</span>} {importingData ? 'Import...' : 'Importa JSON'}
                        <input type="file" accept=".json" style={{ display: 'none' }} onChange={onImportFile} disabled={importingData} />
                    </label>
                </div>
            </div>

            <div className="section-divider">
                <h3 style={{margin: '0 0 10px 0',color: 'var(--text-main)'}}><span aria-hidden="true">🔐</span> Backup personale (solo tuo uso)</h3>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Il backup legge tutto lo storico disponibile nel cloud e include la copia locale. Senza connessione puoi scegliere una copia parziale del dispositivo.</p>
                <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>“Importa JSON” aggiunge i dati mancanti. “Ripristina” sostituisce i campi presenti nel file, dopo un’anteprima. Le modifiche su altri dispositivi durante l’esportazione possono richiedere un nuovo backup.</p>
                <p style={{ margin: '0 0 15px 0', fontSize: '0.75rem', color: 'var(--warning-color)' }}>L'importazione da altri utenti non ripristinerà cronologie personali per sicurezza.</p>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn" style={{ flex: 1, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', margin: 0 }} onClick={onExportBackup} disabled={exportingData}>
                        <span aria-hidden="true">📤</span> {exportingData ? 'Preparazione backup…' : 'Backup JSON'}
                    </button>
                    <label className="btn btn-primary" style={{ flex: 1, margin: 0, textAlign: 'center', cursor: 'pointer', opacity: importingData ? 0.7 : 1 }}>
                        {importingData ? <span aria-hidden="true">⏳</span> : <span aria-hidden="true">📥</span>} {importingData ? 'Import...' : 'Ripristina'}
                        <input type="file" accept=".json" style={{ display: 'none' }} onChange={event => onImportFile(event, 'restore')} disabled={importingData} />
                    </label>
                </div>
            </div>

            <div className="section-divider">
                <h3 style={{margin: '0 0 10px 0',color: 'var(--text-main)'}}><span aria-hidden="true">📊</span> Esportazione Legacy</h3>
                <button className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', width: '100%', marginBottom: 0 }} onClick={onExportCSV}>
                    <Save size={16} aria-hidden="true" /> Esporta dati (CSV)
                </button>
            </div>

            <div style={{ textAlign: 'center', marginTop: '30px', marginBottom: '10px' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Versione {__APP_VERSION__} &middot; build {__BUILD_HASH__} &middot; {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(__BUILD_TIME__))}
                </p>
            </div>
        </>
    );
}
