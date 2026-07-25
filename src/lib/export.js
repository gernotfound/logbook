export const Exporter = {
    exportToCSV(history, nutrition) {
        let workoutCsv = "Data,Nome Allenamento,Esercizio,Serie,Ripetizioni,Peso (kg)\n";
        history.forEach(session => {
            const dateStr = session.globalStartTime ? new Date(session.globalStartTime).toLocaleString() : "Data Sconosciuta";
            const routineName = `"${session.routineName || 'Allenamento Libero'}"`;
            if (session.exercises && session.exercises.length > 0) {
                session.exercises.forEach(ex => {
                    const exName = `"${ex.name || 'Sconosciuto'}"`;
                    if (ex.sets && ex.sets.length > 0) {
                        ex.sets.forEach((set, idx) => {
                            if (!set.reps && !set.weight) return;
                            workoutCsv += `${dateStr},${routineName},${exName},${idx + 1},${set.reps || 0},${set.weight || 0}\n`;
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
            alert("Nessun allenamento da esportare.");
        }
        if (nutritionDates.length > 0) {
            setTimeout(() => {
                this.downloadFile("misurazioni.csv", nutritionCsv);
            }, 500);
        }
    },
    downloadFile(filename, content) {
        const blob = new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8;' }); // \uFEFF è la BOM per Excel
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
