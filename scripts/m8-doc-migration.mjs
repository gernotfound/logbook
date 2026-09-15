import fs from 'node:fs';

function replaceOne(path, from, to) {
  const source = fs.readFileSync(path, 'utf8');
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one match, found ${count}`);
  fs.writeFileSync(path, source.replace(from, to), 'utf8');
}

replaceOne(
  '.agents/rules/storage-and-sync.md',
  `La pipeline V3 mantiene il debounce solo per il tentativo di replica cloud, ma rende immediata e durevole la persistenza locale:\n\n1. I componenti invocano \`saveUserData\` / \`updateUserData\` tramite lo store.\n2. Prima del debounce cloud, \`commitLocal()\` persiste immediatamente in IndexedDB lo stato e le \`SemanticOperation\` nel journal owner-scoped.\n3. \`documentProjection.ts\` proietta UserData in root + shard mensili; \`semanticProjection.ts\` genera diff deterministici per proprietà/entità con Vector Clock e tombstone.\n4. \`transactionWriter.ts\` legge i documenti Firestore toccati, normalizza data schema + sync protocol, valida \`_sync\`, confronta FieldStamp remoto e operation locale, quindi esegue al massimo una write per documento toccato.\n5. \`replicateJournal.ts\` drena il journal verso Firestore. In assenza di rete o dopo timeout, le operation restano durevoli nel journal.\n6. \`hydrateLocal()\` assorbe il causal context remoto senza modificare gli stamp delle pending già esistenti e riproduce il journal localmente.`,
  `La pipeline V4 mantiene debounce e protocollo causale delle milestone precedenti, ma M8 rende esplicito l'intento business:\n\n1. Le normali azioni UI/hook invocano \`dispatchDomainOperation()\` con una \`DomainOperation\` tipizzata.\n2. Il reducer puro calcola il nuovo \`UserData\`; \`commitDomainOperations()\` compila soltanto lo scope dichiarato in \`SemanticOperation\` e persiste business state + journal nello stesso update IndexedDB.\n3. \`documentProjection.ts\` continua a proiettare UserData in root + shard mensili; \`semanticProjection.ts\` resta la fonte di merge policy, Vector Clock, tombstone, \`$order\` e active-workout guard.\n4. \`transactionWriter.ts\` legge i documenti Firestore toccati, normalizza data schema + sync protocol, valida \`_sync\`, confronta FieldStamp remoto e operation locale, quindi esegue al massimo una write per documento toccato.\n5. \`replicateJournal.ts\` drena lo stesso journal V4 verso Firestore. In assenza di rete o dopo timeout, le operation restano durevoli nel journal.\n6. \`hydrateLocal()\` assorbe il causal context remoto senza modificare gli stamp delle pending già esistenti e riproduce il journal localmente.\n\nI boundary bulk — bootstrap/initialize, hydration, guest→account merge, import/restore e recovery — possono continuare a usare il percorso snapshot \`saveUserData/updateUserData/commitLocal\`. Non costituiscono il percorso normativo per una normale mutazione utente.\n\n**MUST:** nuovi consumer business ordinari non possono introdurre bypass snapshot fuori dall'allowlist verificata dal gate M8.\n\n**MUST:** Domain Operations V4 non cambia Data Schema 1, Sync Protocol 1, Local Envelope 4 o Backup Schema 3.`,
);

replaceOne(
  'AGENTS.md',
  `| [\`.agents/rules/storage-and-sync.md\`](.agents/rules/storage-and-sync.md) | Architettura storage, pipeline di salvataggio, merge, blindatura background |`,
  `| [\`.agents/rules/storage-and-sync.md\`](.agents/rules/storage-and-sync.md) | Architettura storage, pipeline di salvataggio, merge, blindatura background |\n| [\`.agents/rules/domain-operations.md\`](.agents/rules/domain-operations.md) | Domain Operations V4, boundary di mutazione, compiler semantico, identità e ordering |`,
);

console.log('M8 documentation migration applied');
