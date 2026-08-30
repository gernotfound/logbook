const fs = require('fs');
let content = fs.readFileSync('src/lib/db.ts', 'utf8');

content = content.replace(/import \{ auth, db, waitForPendingWrites, deleteUser \} from '\.\/firebase';/g, 
  'import { auth, getDb, waitForPendingWrites, deleteUser, ensureAppCheck } from \'./firebase\';');

content = content.replace(/doc\(db, /g, 'doc(getDb(), ');
content = content.replace(/collection\(db, /g, 'collection(getDb(), ');
content = content.replace(/writeBatch\(db\)/g, 'writeBatch(getDb())');
content = content.replace(/syncGlobalCatalog\(db\)/g, 'syncGlobalCatalog(getDb())');
content = content.replace(/waitForPendingWrites\(db\)/g, 'waitForPendingWrites(getDb())');

content = content.replace('const docRef = doc(getDb(), \"users\", user.uid);',
  'await ensureAppCheck();\n            const docRef = doc(getDb(), \"users\", user.uid);');

content = content.replace('const batch = writeBatch(getDb());',
  'await ensureAppCheck();\n            const batch = writeBatch(getDb());');

content = content.replace('const [histSnap, nutSnap, errSnap, evtSnap, anomSnap] = await Promise.all([',
  'await ensureAppCheck();\n            const [histSnap, nutSnap, errSnap, evtSnap, anomSnap] = await Promise.all([');

fs.writeFileSync('src/lib/db.ts', content);
console.log('db.ts patched');
