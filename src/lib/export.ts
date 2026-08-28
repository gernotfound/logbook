import { useDialogStore } from '../store/useDialogStore';
import { Logic } from './logic';

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
            this.downloadFile("allenamenti.csv", workoutCsv);
        } else {
            await useDialogStore.getState().showAlert("Nessun allenamento da esportare.");
        }
        if (nutritionDates.length > 0) {
            setTimeout(() => {
                this.downloadFile("misurazioni.csv", nutritionCsv);
            }, 500);
        }
    },
    async downloadFile(filename: string, content: string) {
        const blob = new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8;' }); // \uFEFF è la BOM per Excel
        
        if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
            try {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'CSV File',
                        accept: { 'text/csv': ['.csv'] },
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
    }
};
