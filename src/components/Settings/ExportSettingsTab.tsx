import type { ChangeEvent } from 'react';
import { Archive, FileSpreadsheet, Share2, Upload } from 'lucide-react';
import { ExportSelector, type ExportSelection, type ExportSelectorItem } from '../ExportSelector';
import type { ImportMode } from '../../lib/backup';

const EMPTY_EXPORT_ITEMS: ExportSelectorItem[] = [];
type ExportShareOptions = { exportLibrary?: boolean | string[]; exportRoutines?: boolean | string[]; exportTrainingCycles?: boolean | string[]; };

interface ExportSettingsTabProps {
    library?: ExportSelectorItem[]; routines?: ExportSelectorItem[]; trainingCycles?: ExportSelectorItem[];
    exportLibrary: ExportSelection; exportRoutines: ExportSelection; exportTrainingCycles: ExportSelection;
    onLibrarySelectionChange: (value: ExportSelection) => void; onRoutinesSelectionChange: (value: ExportSelection) => void; onTrainingCyclesSelectionChange: (value: ExportSelection) => void;
    onExportShare: (options?: ExportShareOptions) => void | Promise<void>; onExportBackup: () => void | Promise<void>; onExportCSV: () => void;
    onImportFile: (event: ChangeEvent<HTMLInputElement>, mode?: ImportMode) => void | Promise<void>;
    importingData: boolean; exportingData: boolean;
}

export function ExportSettingsTab(props: ExportSettingsTabProps) {
    const { library, routines, trainingCycles, exportLibrary, exportRoutines, exportTrainingCycles, onLibrarySelectionChange, onRoutinesSelectionChange, onTrainingCyclesSelectionChange, onExportShare, onExportBackup, onExportCSV, onImportFile, importingData, exportingData } = props;
    const noShareSelection = exportLibrary === 'none' && exportRoutines === 'none' && exportTrainingCycles === 'none';
    return (
        <section className="settings-detail-stack" aria-label="Dati e backup">
            <div className="settings-detail-card">
                <h2><Share2 size={20} aria-hidden="true" /> Condividi con altri atleti</h2>
                <p className="settings-help">Scegli quali Esercizi, Schede e Pianificazioni includere nel file da condividere.</p>
                <ExportSelector title="Esercizi (Libreria)" items={library || EMPTY_EXPORT_ITEMS} selection={exportLibrary} onChange={onLibrarySelectionChange} />
                <ExportSelector title="Schede (Routines)" items={routines || EMPTY_EXPORT_ITEMS} selection={exportRoutines} onChange={onRoutinesSelectionChange} />
                <ExportSelector title="Pianificazioni (Cicli)" items={trainingCycles || EMPTY_EXPORT_ITEMS} selection={exportTrainingCycles} onChange={onTrainingCyclesSelectionChange} />
                <div className="settings-actions">
                    <button type="button" className="btn" onClick={() => onExportShare({
                        exportLibrary: exportLibrary === 'all' ? true : exportLibrary === 'none' ? false : exportLibrary,
                        exportRoutines: exportRoutines === 'all' ? true : exportRoutines === 'none' ? false : exportRoutines,
                        exportTrainingCycles: exportTrainingCycles === 'all' ? true : exportTrainingCycles === 'none' ? false : exportTrainingCycles
                    })} disabled={noShareSelection}><Archive size={18} aria-hidden="true" /> Esporta JSON</button>
                    <label className={'btn btn-primary settings-file-button ' + (importingData ? 'is-disabled' : '')}><Upload size={18} aria-hidden="true" /> {importingData ? 'Importazione...' : 'Importa JSON'}<input type="file" accept=".json" hidden onChange={onImportFile} disabled={importingData} /></label>
                </div>
            </div>
            <div className="settings-detail-card">
                <h2><Archive size={20} aria-hidden="true" /> Backup personale</h2>
                <p className="settings-help">Il backup legge tutto lo storico disponibile nel cloud e include la copia locale. Senza connessione puoi scegliere una copia parziale del dispositivo.</p>
                <p className="settings-help">“Importa JSON” aggiunge i dati mancanti. “Ripristina” sostituisce i campi presenti nel file, dopo un’anteprima. Le modifiche su altri dispositivi durante l’esportazione possono richiedere un nuovo backup.</p>
                <p className="settings-help settings-warning">L'importazione da altri utenti non ripristinerà cronologie personali per sicurezza.</p>
                <div className="settings-actions">
                    <button type="button" className="btn" onClick={onExportBackup} disabled={exportingData}><Archive size={18} aria-hidden="true" /> {exportingData ? 'Preparazione backup…' : 'Backup JSON'}</button>
                    <label className={'btn btn-primary settings-file-button ' + (importingData ? 'is-disabled' : '')}><Upload size={18} aria-hidden="true" /> {importingData ? 'Importazione...' : 'Ripristina'}<input type="file" accept=".json" hidden onChange={event => onImportFile(event, 'restore')} disabled={importingData} /></label>
                </div>
            </div>
            <div className="settings-detail-card">
                <h2><FileSpreadsheet size={20} aria-hidden="true" /> Esportazione CSV</h2>
                <p className="settings-help">Crea file tabellari dai dati attualmente caricati su questo dispositivo. Il CSV è pensato per analisi in un foglio di calcolo e non sostituisce il Backup JSON completo del cloud.</p>
                <button type="button" className="btn settings-full" onClick={onExportCSV}><FileSpreadsheet size={18} aria-hidden="true" /> Esporta CSV (dati caricati)</button>
            </div>
        </section>
    );
}
