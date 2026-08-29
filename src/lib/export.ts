import { useDialogStore } from '../store/useDialogStore';
import { useAppStore } from '../store/useAppStore';
import { Logic } from './logic';
import { UserDataSchema } from './schema';
import type { UserData } from '../types';

export const Exporter = {
    async exportToCSV(history: any[], nutrition: Record<string, any>, library: any[] = []) {
        const libMap = new Map<string, any>(library.map(l => [l.id, l]));
        let workoutCsv = "Data,Nome allenamento,Esercizio,Serie,Ripetizioni,Tempo,Peso (kg),Distanza (km),Velocità (km/h),Inclinazione,Kcal bruciate,Durata Sessione,Umore,Pump,Fatica,Acqua (L)\n";
        history.forEach(session => {
            const dateStr = session.globalStartTime 
                ? new Date(session.globalStartTime).toLocaleString() 
                : (session.date || "Data sconosciuta");
            const routineName = `"${session.routineName || 'Allenamento libero'}"`;
            
            // Session global metrics
            const sessionDuration = session.globalDurationStr || session.manualDurationStr || "";
            const mood = session.moodRating || "";
            const pump = session.pumpRating || "";
            const fatigue = session.fatigueRating || "";
            const water = session.waterLiters || "";
            const globalMetrics = `${sessionDuration},${mood},${pump},${fatigue},${water}`;

            if (session.exercises && session.exercises.length > 0) {
                session.exercises.forEach((ex: any) => {
                    const libEx = libMap.get(ex.exId);
                    const exName = `"${libEx ? libEx.name : (ex.name || ex.exId || 'Sconosciuto')}"`;
                    if (ex.sets && ex.sets.length > 0) {
                        ex.sets.forEach((set: any, idx: number) => {
                            const kg = set.kg !== undefined ? set.kg : (set.weight !== undefined ? set.weight : "");
                            const reps = set.reps !== undefined ? set.reps : "";
                            const time = set.time !== undefined ? set.time : "";
                            const distance = set.distance !== undefined ? set.distance : "";
                            const speed = set.speed !== undefined ? set.speed : "";
                            const incline = set.incline !== undefined ? set.incline : "";
                            const kcal = set.kcal !== undefined ? set.kcal : "";
                            const setPrefix = `"${dateStr}",${routineName},${exName}`;
                            
                            workoutCsv += `${setPrefix},${idx + 1},${reps},${time},${kg},${distance},${speed},${incline},${kcal},${globalMetrics}\n`;
                            
                            // Gestione Dropset nel CSV
                            if (set.dropsets && set.dropsets.length > 0) {
                                set.dropsets.forEach((ds: any, dsIdx: number) => {
                                    const dsKg = ds.kg !== undefined ? ds.kg : "";
                                    const dsReps = ds.reps !== undefined ? ds.reps : "";
                                    const label = set.dropsets.length > 1 ? `${idx + 1} (Dropset ${dsIdx + 1})` : `${idx + 1} (Dropset)`;
                                    workoutCsv += `${setPrefix},"${label}",${dsReps},,${dsKg},,,,,${globalMetrics}\n`;
                                });
                            }
                            
                            // Gestione Isometrie nel CSV
                            if (set.isometrics && set.isometrics.length > 0) {
                                set.isometrics.forEach((iso: any, isoIdx: number) => {
                                    const isoKg = iso.kg !== undefined ? iso.kg : "";
                                    const isoTime = iso.time ? `${iso.time}s` : "";
                                    const label = set.isometrics.length > 1 ? `${idx + 1} (Isometria ${isoIdx + 1})` : `${idx + 1} (Isometria)`;
                                    workoutCsv += `${setPrefix},"${label}",,${isoTime},${isoKg},,,,,${globalMetrics}\n`;
                                });
                            }
                        });
                    }
                });
            }
        });
        
        let nutritionCsv = "Data,Peso (kg),Kcal,Carbo (g),Pro (g),Grassi (g),BF (%),Collo (cm),Torace (cm),Spalle (cm),Braccia (cm),Vita (cm),Fianchi (cm),Cosce (cm),Polpacci (cm),Ore sonno,Sonno profondo,Sonno leggero,Sonno REM,Tempo sveglio,Note\n";
        const nutritionDates = Object.keys(nutrition).sort();
        nutritionDates.forEach(date => {
            const n = nutrition[date];
            let safeNotes = "";
            if (n.notes) {
                // Rimuove newlines per non rompere il formato CSV, e escape di virgolette
                safeNotes = `"${n.notes.replace(/(\r\n|\n|\r)/gm, " ").replace(/"/g, '""')}"`;
            }
            const sHours = Logic.formatSleepTime(n.sleepHours);
            const sDeep = Logic.formatSleepTime(n.sleepDeep);
            const sLight = Logic.formatSleepTime(n.sleepLight);
            const sRem = Logic.formatSleepTime(n.sleepRem);
            const sAwake = Logic.formatSleepTime(n.sleepAwake);
            nutritionCsv += `${date},${n.weight || ''},${n.kcal || ''},${n.carbs || ''},${n.pro || ''},${n.fat || ''},${n.bf || ''},${n.neck || ''},${n.chest || ''},${n.shoulders || ''},${n.biceps || ''},${n.waist || ''},${n.hips || n.hip || ''},${n.thighs || ''},${n.calves || ''},${sHours},${sDeep},${sLight},${sRem},${sAwake},${safeNotes}\n`;
        });
        
        const workoutHeader = "Data,Nome allenamento,Esercizio,Serie,Ripetizioni,Tempo,Peso (kg),Distanza (km),Velocità (km/h),Inclinazione,Kcal bruciate,Durata Sessione,Umore,Pump,Fatica,Acqua (L)\n";
        if (workoutCsv !== workoutHeader) {
            this.downloadFile("allenamenti.csv", workoutCsv, "text/csv;charset=utf-8;");
        } else {
            useDialogStore.getState().showAlert("Nessun allenamento da esportare.");
        }
        if (nutritionDates.length > 0) {
            setTimeout(() => {
                this.downloadFile("misurazioni.csv", nutritionCsv, "text/csv;charset=utf-8;");
            }, 500);
        }
    },

    async downloadFile(filename: string, content: string, type: string = "text/csv;charset=utf-8;") {
        const prefix = type.includes("csv") ? "\uFEFF" : "";
        const blob = new Blob([prefix + content], { type });
        
        if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: type.includes("json") ? 'JSON File' : 'CSV File',
                        accept: type.includes("json") ? { 'application/json': ['.json'] } : { 'text/csv': ['.csv'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    return; // Utente ha annullato
                }
                if (err.name === 'SecurityError' || err.name === 'TypeError') {
                    console.warn("showSaveFilePicker bloccato, uso fallback nativo:", err);
                    // Lascia procedere al fallback fuori dal blocco
                } else {
                    console.error("Esportazione fallita:", err);
                    useDialogStore.getState().showAlert("Esportazione fallita, riprova.");
                    return;
                }
            }
        }
        
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Cleanup memory
    },

    async exportShareJson(
        userData: UserData,
        options: {
            exportLibrary?: boolean | string[],
            exportRoutines?: boolean | string[],
            exportTrainingCycles?: boolean | string[]
        } = { exportLibrary: true, exportRoutines: true, exportTrainingCycles: true }
    ): Promise<{ libraryCount: number; routinesCount: number; cyclesCount: number }> {
        
        const libraryIds = new Set<string>();
        const routineIds = new Set<string>();
        const cycleIds = new Set<string>();

        // 1. Aggiungi le selezioni esplicite
        if (options.exportTrainingCycles === true) {
            (userData.trainingCycles || []).forEach(c => cycleIds.add(c.id));
        } else if (Array.isArray(options.exportTrainingCycles)) {
            options.exportTrainingCycles.forEach(id => cycleIds.add(id));
        }

        if (options.exportRoutines === true) {
            (userData.routines || []).forEach(r => routineIds.add(r.id));
        } else if (Array.isArray(options.exportRoutines)) {
            options.exportRoutines.forEach(id => routineIds.add(id));
        }

        if (options.exportLibrary === true) {
            (userData.library || []).forEach(e => libraryIds.add(e.id));
        } else if (Array.isArray(options.exportLibrary)) {
            options.exportLibrary.forEach(id => libraryIds.add(id));
        }

        // 2. Risoluzione dipendenze: Cicli -> Schede
        if (cycleIds.size > 0) {
            (userData.trainingCycles || []).forEach(c => {
                if (cycleIds.has(c.id) && Array.isArray(c.routines)) {
                    c.routines.forEach(rId => routineIds.add(rId));
                }
            });
        }

        // 3. Risoluzione dipendenze: Schede -> Esercizi
        if (routineIds.size > 0) {
            (userData.routines || []).forEach(r => {
                if (routineIds.has(r.id) && Array.isArray(r.exercises)) {
                    r.exercises.forEach(ex => libraryIds.add(ex.exId));
                }
            });
        }

        // 4. Filtra gli array reali ignorando ID inesistenti o orfani
        const finalLibrary = (userData.library || []).filter(e => libraryIds.has(e.id));
        const finalRoutines = (userData.routines || []).filter(r => routineIds.has(r.id));
        const finalCycles = (userData.trainingCycles || []).filter(c => cycleIds.has(c.id));

        const payload = {
            version: 1,
            type: 'share',
            exportedAt: new Date().toISOString(),
            library: finalLibrary,
            routines: finalRoutines,
            trainingCycles: finalCycles
        };

        const content = JSON.stringify(payload, null, 2);
        this.downloadFile("logbook_condivisione.json", content, 'application/json');
        
        return {
            libraryCount: finalLibrary.length,
            routinesCount: finalRoutines.length,
            cyclesCount: finalCycles.length
        };
    },

    async exportBackupJson(userData: UserData, currentUser: any) {
        const payload = {
            version: 1,
            type: 'backup',
            exportedAt: new Date().toISOString(),
            userId: currentUser?.uid || null,
            profile: userData.profile,
            library: userData.library || [],
            routines: userData.routines || [],
            trainingCycles: userData.trainingCycles || [],
            nutritionPlanning: userData.nutritionPlanning,
            history: userData.history || [],
            nutrition: userData.nutrition || {},
            supplements: userData.supplements || []
        };
        const content = JSON.stringify(payload, null, 2);
        this.downloadFile("logbook_backup.json", content, 'application/json');
    },

    async importFromJson(file: File, currentUser: any, saveUserData: any) {
        return new Promise<void>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const content = e.target?.result as string;
                    const payload = JSON.parse(content);
                    
                    if (payload.version !== 1 || !['share', 'backup'].includes(payload.type)) {
                        throw new Error("Formato file non valido o non supportato.");
                    }

                    if (payload.type === 'backup') {
                        if (payload.userId !== null && payload.userId !== undefined && currentUser?.uid && payload.userId !== currentUser.uid) {
                            throw new Error("Sicurezza: Non puoi importare il backup di un altro utente. Questo sovrascriverebbe le tue cronologie personali.");
                        }
                    }

                    const currentData = useAppStore.getState().userData || {};
                    let mergedData: any = { ...currentData };

                    const mergeArrayById = (arr1: any[], arr2: any[]) => {
                        const map = new Map<string, any>(arr1.map(item => [item.id, item]));
                        arr2.forEach(item => {
                            if (!map.has(item.id)) {
                                map.set(item.id, item); // Diamo priorità ai dati locali non sovrascrivendo se esiste già
                            }
                        });
                        return Array.from(map.values());
                    };

                    mergedData.library = mergeArrayById(currentData.library || [], payload.library || []);
                    mergedData.routines = mergeArrayById(currentData.routines || [], payload.routines || []);
                    mergedData.trainingCycles = mergeArrayById(currentData.trainingCycles || [], payload.trainingCycles || []);

                    if (payload.type === 'backup') {
                        if (payload.profile && !currentData.profile) {
                            mergedData.profile = payload.profile;
                        }
                        if (payload.nutritionPlanning && !currentData.nutritionPlanning) {
                            mergedData.nutritionPlanning = payload.nutritionPlanning;
                        }
                        mergedData.supplements = mergeArrayById(currentData.supplements || [], payload.supplements || []);
                        
                        // History: append by ID or original fallback
                        const currentHistory = currentData.history || [];
                        const histMap = new Map(currentHistory.map(h => [h.id || ((h.date || '') + (h.routineName || '')), h]));
                        (payload.history || []).forEach((h: any) => {
                            const k = h.id || ((h.date || '') + (h.routineName || ''));
                            if (!histMap.has(k)) histMap.set(k, h);
                        });
                        mergedData.history = Array.from(histMap.values());

                        // Nutrition
                        const currentNut = currentData.nutrition || {};
                        const payloadNut = payload.nutrition || {};
                        const newNut = { ...currentNut };
                        for (const date in payloadNut) {
                            if (!newNut[date]) {
                                newNut[date] = payloadNut[date];
                            } else {
                                // Merge date
                                const d1 = newNut[date];
                                const d2 = payloadNut[date];
                                d1.meals = mergeArrayById(d1.meals || [], d2.meals || []);
                                d1.supplementsIntake = mergeArrayById(d1.supplementsIntake || [], d2.supplementsIntake || []);
                            }
                        }
                        mergedData.nutrition = newNut;
                    }

                    const finalData = UserDataSchema.parse(mergedData);
                    
                    // Applica al globale in modo safe tramite store
                    await saveUserData(() => finalData);
                    
                    useDialogStore.getState().showAlert(
                        payload.type === 'share' 
                        ? "Importazione completata: Esercizi, Schede e Pianificazioni aggiornati." 
                        : "Ripristino backup completato con successo."
                    );
                    resolve();
                } catch (err: any) {
                    console.error("Import error:", err);
                    useDialogStore.getState().showAlert(err.message || "Errore durante l'importazione del file JSON.");
                    reject(err);
                }
            };
            reader.readAsText(file);
        });
    }
};
