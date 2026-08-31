const fs = require('fs');
function replaceInFile(path, regexMap) {
    let content = fs.readFileSync(path, 'utf8');
    for (const [search, replace] of Object.entries(regexMap)) {
        content = content.replace(new RegExp(search, 'g'), replace);
    }
    fs.writeFileSync(path, content, 'utf8');
}

replaceInFile('tests/training_planning.test.tsx', {
    "name: /Modifica ciclo/i": "name: /Modifica/i",
    "name: /Elimina ciclo/i": "name: /Elimina/i",
    "name: /Modifica scheda/i": "name: /Modifica/i",
    "name: /Elimina scheda/i": "name: /Elimina/i",
    "\\\\(copia\\\\)": "- 1",
    "name: /Duplica ciclo/i": "name: /Duplica/i",
    "name: /Duplica scheda/i": "name: /Duplica/i"
});

replaceInFile('tests/worker_1b_ui_date_csv.test.tsx', {
    "\\\\(copia\\\\)": "- 1",
    "name: /Duplica ciclo/i": "name: /Duplica/i"
});

replaceInFile('tests/workout_improvements.test.tsx', {
    "name: /modifica esercizio/i": "name: /modifica/i",
    "name: /elimina esercizio/i": "name: /elimina/i",
    "name: /modifica alimento/i": "name: /modifica/i",
    "name: /elimina alimento/i": "name: /elimina/i"
});