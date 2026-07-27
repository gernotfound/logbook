import { useDialogStore } from '../store/useDialogStore';

export const Exporter = {
    async exportToCSV(history: any[], nutrition: Record<string, any>) {
        let workoutCsv = "Data,Nome Allenamento,Esercizio,Serie,Ripetizioni,Peso (kg)\n";
        history.forEach(session => {
            const dateStr = session.globalStartTime ? new Date(session.globalStartTime).toLocaleString() : "Data Sconosciuta";
            const routineName = `"${session.routineName || 'Allenamento Libero'}"`;
            if (session.exercises && session.exercises.length > 0) {
                session.exercises.forEach((ex: any) => {
                    // Support both legacy 'name' field and new 'exId' lookup
                    const exName = `"${ex.name || ex.exId || 'Sconosciuto'}"`;
                    if (ex.sets && ex.sets.length > 0) {
                        ex.sets.forEach((set: any, idx: number) => {
                            // BUG FIX: new app uses set.kg (not set.weight)
                            const kg = set.kg !== undefined ? set.kg : (set.weight || 0);
                            const reps = set.reps || 0;
                            if (!reps && !kg) return;
                            workoutCsv += `${dateStr},${routineName},${exName},${idx + 1},${reps},${kg}\n`;
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
        if (workoutCsv !== "Data,Nome Allenamento,Esercizio,Serie,Ripetizioni,Peso (kg)\n") {
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
