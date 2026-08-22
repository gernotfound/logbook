const fs = require('fs');
let content = fs.readFileSync('src/lib/appCheck.ts', 'utf8');
content = content.replace("    type AppCheckToken\n", "");
fs.writeFileSync('src/lib/appCheck.ts', content);
