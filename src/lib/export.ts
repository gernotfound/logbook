import { useDialogStore } from '../store/useDialogStore';

export const Exporter = {
    async exportToCSV(history: any[], nutrition: Record<string, any>, library: any[] = []) {
        let workoutCsv = "Data,Nome allenamento,Esercizio,Serie,Ripetizioni,Peso (kg)\n";
        history.forEach(session => {
            const dateStr = session.globalStartTime ? new Date(session.globalStartTime).toLocaleString() : "Data sconosciuta";
            const routineName = `"${session.routineName || 'Allenamento libero'}"`;
            if (session.exercises && session.exercises.length > 0) {
                session.exercises.forEach((ex: any) => {
                    const libEx = library.find(l => l.id === ex.exId);
                    const exName = `"${libEx ? libEx.name : (ex.name || ex.exId || 'Sconosciuto')}"`;
                    if (ex.sets && ex.sets.length > 0) {
                        ex.sets.forEach((set: any, idx: number) => {
                            // BUG FIX: new app uses set.kg (not set.weight)
                            const kg = set.kg !== undefined ? set.kg : (set.weight || 0);
                            const repsOrTime = (set.time !== undefined && set.time !== '' && set.time !== null) ? set.time : (set.reps || 0);
                            if (repsOrTime || kg) {
                                workoutCsv += `${dateStr},${routineName},${exName},${idx + 1},${repsOrTime},${kg}\n`;
                            }

                            // Serie speciali: Dropsets
                            if (Array.isArray(set.dropsets)) {
                                set.dropsets.forEach((ds: any, dsIdx: number) => {
                                    const dsKg = ds.kg !== undefined ? ds.kg : 0;
                                    const dsReps = ds.reps || 0;
                                    const label = set.dropsets.length > 1 ? `${idx + 1} (Dropset ${dsIdx + 1})` : `${idx + 1} (Dropset)`;
                                    workoutCsv += `${dateStr},${routineName},${exName},"${label}",${dsReps},${dsKg}\n`;
                                });
                            }

                            // Serie speciali: Isometrie
                            if (Array.isArray(set.isometrics)) {
                                set.isometrics.forEach((iso: any, isoIdx: number) => {
                                    const isoKg = iso.kg !== undefined ? iso.kg : 0;
                                    const isoTime = iso.time ? `${iso.time}s` : '0s';
                                    const label = set.isometrics.length > 1 ? `${idx + 1} (Isometria ${isoIdx + 1})` : `${idx + 1} (Isometria)`;
                                    workoutCsv += `${dateStr},${routineName},${exName},"${label}",${isoTime},${isoKg}\n`;
                                });
                            }
                        });
                    }
                });
            }
        });
        let nutritionCsv = "Data,Peso (kg),Kcal,Carbo (g),Pro (g),Grassi (g),BF (%),Note\n";
        const nutritionDates = Object.keys(nutrition).sort();
        nutritionDates.forEach(date => {
            const n = nutrition[date];
            const notes = n.notes ? `"${n.notes.replace(/"/g, '""')}"` : "";
            nutritionCsv += `${date},${n.weight || ''},${n.kcal || ''},${n.carbs || ''},${n.pro || ''},${n.fat || ''},${n.bf || ''},${notes}\n`;
        });
        if (workoutCsv !== "Data,Nome allenamento,Esercizio,Serie,Ripetizioni,Peso (kg)\n") {
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
    downloadFile(filename: string, content: string) {
        const blob = new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8;' }); // \uFEFF è la BOM per Excel
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
