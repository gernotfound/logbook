const fs = require('fs');
const path = require('path');

function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
        let p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) {
            walk(p);
        } else if (p.endsWith('.jsx')) {
            fs.renameSync(p, p.replace('.jsx', '.tsx'));
        } else if (p.endsWith('.js') && !p.includes('vite.config') && !p.includes('vitest.config')) {
            fs.renameSync(p, p.replace('.js', '.ts'));
        }
    });
}
walk('./src');
