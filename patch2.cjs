const fs = require('fs');

let authContext = fs.readFileSync('src/contexts/AuthContext.tsx', 'utf8');
authContext = authContext.replace(/import \{ auth, db, /g, 'import { auth, getDb, ');
authContext = authContext.replace(/waitForPendingWrites\(db\)/g, 'waitForPendingWrites(getDb())');
fs.writeFileSync('src/contexts/AuthContext.tsx', authContext);

let telemetryHub = fs.readFileSync('src/lib/telemetryHub.ts', 'utf8');
telemetryHub = telemetryHub.replace(/import \{ db, auth \} from '\.\/firebase';/g, 'import { getDb, auth, ensureAppCheck } from \'./firebase\';');
telemetryHub = telemetryHub.replace(/collection\(db, /g, 'collection(getDb(), ');
telemetryHub = telemetryHub.replace(/setDoc\(doc\(db, /g, 'setDoc(doc(getDb(), ');
telemetryHub = telemetryHub.replace('const eventDocRef = doc(getDb(),', 'await ensureAppCheck();\n    const eventDocRef = doc(getDb(),');
telemetryHub = telemetryHub.replace('const errorDocRef = doc(getDb(),', 'await ensureAppCheck();\n    const errorDocRef = doc(getDb(),');
fs.writeFileSync('src/lib/telemetryHub.ts', telemetryHub);

let storageTelemetry = fs.readFileSync('src/lib/storageTelemetry.ts', 'utf8');
storageTelemetry = storageTelemetry.replace(/import \{ db, auth \} from '\.\/firebase';/g, 'import { getDb, auth, ensureAppCheck } from \'./firebase\';');
storageTelemetry = storageTelemetry.replace(/collection\(db, /g, 'collection(getDb(), ');
storageTelemetry = storageTelemetry.replace(/addDoc\(collection\(getDb\(\), /g, 'await ensureAppCheck();\n    await addDoc(collection(getDb(), ');
fs.writeFileSync('src/lib/storageTelemetry.ts', storageTelemetry);

console.log('Patched the rest');
