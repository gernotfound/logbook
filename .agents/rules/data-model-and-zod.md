# Modello Dati e Validazione Zod — TheLogBook

**Quando leggere:** nuove chiavi, identità business, UserData, Zod, proiezioni Firestore e shard mensili.
**Non inferire:** record remoto invalido non equivale a cancellazione business; sanitizzazione parziale non dimostra completezza del mese.

**Autorità:** [`AGENTS.md`](../../AGENTS.md). Questo contratto ne specializza gli invarianti; non amplia autorizzazioni o perimetro.

## Quattro piani distinti

`UserData` è il modello applicativo completo, ma non coincide con un singolo documento Firestore. Prima di aggiungere o spostare un campo, classificare esplicitamente dove vive.

| Piano | Fonte operativa | Contenuto corrente |
|---|---|---|
| **Application `UserData`** | `src/types.ts` + `UserDataSchema` | `profile`, `library`, `routines`, `history`, `nutrition`, `customFoods`, `activeWorkout`, `nutritionPlanning`, `trainingCycles`, `activeCycleId`, `supplements`, `activePains`, `catalogOverrides`, `legalConsent`, `nutritionPlanningOrigin`, `pendingConflicts` |
| **Business root cifrato su Firestore** | `src/lib/sync/documentProjection.ts` (`rootKeys`) + `cloudDocumentCipher.ts` | `profile`, `library`, `routines`, `customFoods`, `activeWorkout`, `trainingCycles`, `activeCycleId`, `nutritionPlanning`, `supplements`, `activePains`, `catalogOverrides`, `legalConsent`, `nutritionPlanningOrigin` |
| **Shard mensili Firestore** | `documentProjection.ts` | `history_months/{YYYY-MM}` e `nutrition_months/{YYYY-MM}` |
| **Application/local-only** | envelope/store | `pendingConflicts` è parte di `UserData` e del recovery locale/backup, ma non è una chiave del root Firestore |

I campi business root e le entità mensili sono contenuti dentro `_sealed`: le Firestore Rules validano envelope cifrato, ownership, consenso e coordinate causali pubbliche, ma **non possono ispezionare gli attributi business**. Zod, integrity check e semantic merge agiscono dopo l'apertura autenticata AEAD nel client. La lista sopra descrive il contenuto business logico, non chiavi top-level leggibili in Firestore.

`library` e `customFoods` sono campi correnti del modello applicativo: in memoria contengono le liste effettive (catalogo globale, custom e override). `projectDocuments` separa custom e differenze prima della write root; `applyRemoteDocuments` ricostruisce le liste alla lettura. Questo adattamento è parte dei salvataggi correnti, non una migrazione di dati pre-lancio, e non va ritirato.

Le date persistite e le chiavi delle giornate nutrizione usano `YYYY-MM-DD` canonico e valido. I lettori di peso/BF recenti, TDEE e calendari non reinterpretano chiavi non padded, date italiane o stringhe con spazi/timestamp come giornate salvate: le ignorano senza riscrivere o cancellare l'input. Il calendario workout conserva il fallback dal `globalStartTime` corrente. `parseDateInput` continua a gestire i formati immessi dall'utente nel form dei cicli; il parsing di input UI non autorizza la conversione di date persistite pre-lancio.

Le cinque durate del sonno di `NutritionDay` (`sleepHours`, `sleepDeep`, `sleepLight`, `sleepRem`, `sleepAwake`) sono stringhe `HH:MM` canoniche (`00:00`–`23:59`). La UI e le Domain Operations della baseline scrivono soltanto tale formato. Il gateway Zod può normalizzare orari con una sola cifra, ma **non** promuove numeri, decimali o suffissi `h` pre-lancio: valori non supportati restano fuori dal modello. Conservare la validazione per input non affidabili, senza cambiare gli altri campi nutrizionali o la copertura mensile.

Le misurazioni corporee non sono un array root `bodyMeasurements`: peso, BF, provenienza BF, circonferenze e sonno sono campi di `NutritionDay`, quindi seguono la persistenza mensilizzata di `nutrition`. La circonferenza fianchi usa solo `hip` in `UserProfile` e `NutritionDay`; l'alias `hips` pre-lancio non viene più importato, promosso durante merge o conservato dalla normalizzazione Zod. I campi addizionali distinti restano governati da `.passthrough()`.

La pianificazione nutrizionale usa `avgMacros`, `onBoost`, `onMacros`, `offMacros` e i target attualmente consumati da UI e calcoli. Le proprietà pre-lancio `lockedMacro`, `chartPeriod` e i rapporti macro duplicati di primo livello (`carbsPerKg`, `proPerKg`, `fatPerKg`) e il totale derivato persistito `totalKcal` non sono più campi di dominio: la normalizzazione Zod le rimuove sia dai piani attivi sia dai conflitti pendenti. I rapporti annidati nei target correnti e i campi forward-compatible distinti rimangono preservati. Il fingerprint di confronto dei conflitti è `v4` e considera i soli campi correnti mappati.

Il confronto UI dei piani ricava le calorie da peso e `avgMacros` tramite lo stesso calcolo dell'editor; non usa il totale pre-lancio. La baseline corrente assegna esplicitamente `nutritionPlanningOrigin` (`generated-default` per bootstrap, `user-edited` dopo interventi utente). In un merge guest→account un piano con origine assente **non** viene classificato come default per somiglianza ai valori iniziali: viene considerato `user-edited`, conservando eventuale conflitto guest senza fondere silenziosamente i piani. `hasUserData` considera tale piano dato da preservare se contiene valori. L'assenza di entrambi i piani rimane innocua.

Conservare la verifica CAS in archivio cifrato e il controllo sessione prima di risolvere un conflitto.

Il formato supportato delle continuazioni di serie workout è soltanto `SessionExerciseSet.segments`, con la tecnica sul segmento. I writer di sessione/routine, l'editor, il recupero, i calcoli, il CSV e il backup/import usano questa struttura. Gli array pre-lancio `dropsets` e `isometrics` non vengono più letti né convertiti: il gateway Zod li esclude dal modello senza mutare l'input, preservando gli altri campi addizionali. La tecnica routine `defaultTechnique: 'isometrics'` resta invece un'impostazione corrente: genera segmenti `technique: 'isometry'`, non un array storico. Restano obbligatori identificativi stabili dei segmenti, callback indirizzati per ID, protezione delle bozze e controllo di integrità cloud contro normalizzazioni lossy.

Il termine temporale di una sessione usa soltanto `globalEndTime`; `globalStartTime`, data business e durate testuali restano i campi correnti per i rispettivi scopi. L'alias `endTime` pre-lancio non è letto da Home, analytics, suggerimenti, progressione, stima durata o CSV e viene escluso dal gateway Zod senza promozione al timestamp canonico.

## Date business e istanti

**MUST:** i giorni business usano `YYYY-MM-DD` nel fuso locale tramite `getLocalDateString()` in `src/lib/utils/date.ts`; non usare `toISOString().slice(0, 10)` per una data locale, perché la conversione UTC può cambiare giorno. Gli istanti evento/audit restano UTC/epoch e lo shard mensile deriva dal giorno business locale.

L'helper di formattazione non valida input persistiti: i gateway devono rifiutare date non canoniche o incoerenti, senza convertirle implicitamente in oggi. Le regole dei calendari e del parsing UI sopra non autorizzano migrazioni dei dati pre-lancio.

## Statistiche derivate: qualità del campione e numeri finiti

**MUST:** i calcoli derivati non presentano campioni insufficienti o numeri non rappresentabili come statistiche affidabili. Un risultato rifiutato non autorizza a modificare misurazioni, workout, diario o target manuali.

- `calculateTDEE()` richiede almeno **sette date distinte con registrazioni valide in 14 giorni di calendario**, ancorati all'ultima data registrata: sette voci sparse in mesi diversi non costituiscono un campione recente. Peso e calorie devono essere numeri finiti, positivi e interamente interpretabili (virgola decimale ammessa): prefissi con suffissi non numerici non sono misurazioni valide. Registrazioni duplicate della stessa giornata non possono essere conteggiate più volte e un campione altrimenti sufficiente con date duplicate va rifiutato, non aggregato arbitrariamente. Una stima rifiutata non sostituisce un obiettivo calorico manuale. Regressioni: `src/lib/logic.test.ts` e `tests/r1_r2_empirical_challenge.test.ts`.
- Statistiche e correlazioni del volume settimanale non pubblicano `NaN`, `Infinity`, somme o variazioni percentuali non finite, anche quando i singoli addendi erano finiti. Il conteggio delle sessioni e la parità del percorso cooperativo restano corretti; il calcolatore meccanico di base conserva il proprio contratto. Regressioni: `src/lib/calc/analytics.test.ts`.

Le formule specifiche restano nel codice; qui si preserva la proprietà di non pubblicare risultati fuorvianti.

I nutrienti per porzione e i totali persistiti del diario devono restare finiti anche dopo moltiplicazione, divisione e somma di input finiti. `createLoggedMealItem` rifiuta conversioni non rappresentabili e `calculateLoggedMealTotals` interrompe reducer, replay e merge prima che i fallback Zod sostituiscano il risultato con zero. `prepareImport` verifica gli stessi calcoli sia in merge sia in restore, preservando entrambi gli archivi in caso di errore; il restore conserva i totali registrati quando il calcolo è rappresentabile. L'arrotondamento delle macro non introduce overflow temporaneo su valori grandi già interi in IEEE-754. Il calcolo raw usato dalla visualizzazione resta distinto dal boundary di scrittura.

## Durata manuale del workout storico

L'input manuale dello storico attraversa `parseManualDuration()` in `src/lib/utils/date.ts` prima della Domain Operation. Un input invalido resta visibile e non viene trasformato dal blur o dal salvataggio in una durata valida inventata; `null` dal parser interrompe il salvataggio prima del commit business durevole. La normalizzazione tollerante usata in altri contesti non sostituisce questo boundary UI strict. Conservare la bozza, la sessione sospesa e i guard del commit come definiti in [Bozze e stato device](device-drafts.md).

## Zod Gateway — difesa runtime

Tutti i dati in ingresso dai boundary persistiti **DEVONO** attraversare decifratura autenticata e formato/versione applicabili, poi il gateway Zod pertinente (`UserDataSchema.parse()` per lo stato applicativo) prima di diventare business state corrente. Non passare ciphertext o metadati di protocollo come se fossero `UserData`.

### Perché è cruciale

I tipi TypeScript svaniscono a runtime. Il Gateway Zod impedisce che dati malformati (`NaN`, stringhe al posto di numeri, `null` inattesi, array mancanti) entrino nel modello operativo senza sanitizzazione/validazione prevista.

### Helper difensivi

Gli schema usano helper specifici con fallback, fra cui:

- `safeString`, `safeOptionalString`;
- `safeNumber`, `safeOptionalNumber`, `safeOptionalNullableNumber`;
- `safeBoolean`, `safeOptionalBoolean`.

Ogni helper applica il comportamento difensivo definito negli schema correnti; non duplicare questa logica nei consumer.

### `.passthrough()` — campi addizionali

I sub-schema possono usare `.passthrough()` dove la compatibilità in avanti è intenzionale.

**SHOULD:** non aggiungere `.passthrough()` come scorciatoia per evitare di modellare un campo persistito. Un campo business nuovo deve avere classificazione storage e schema espliciti.

### Identità business e oggetti fantasma (Ghost Objects)

Gli elementi delle collezioni che hanno un'identità business obbligatoria devono possedere un ID valido **prima** che i fallback permissivi dei campi non-identità vengano applicati.

**MUST:** scartare elementi nulli/primitivi, con ID assente, vuoto o non valido secondo lo schema della collezione. Non generare un ID fittizio e non convertire un valore invalido in stringa pur di conservare il record.

**MAY:** se l'identità è valida ma altri campi sono corrotti, il relativo sub-schema può sanitizzare quei campi secondo fallback modellati e testati, preservando la referenza dell'elemento.

Questa distinzione è già applicata alle collezioni che hanno ricevuto hardening specifico, incluse routines, training cycles e supplements. Quando si introduce una nuova collection schema, la validità dell'identità deve essere esplicita e coperta da test.

**MUST:** un record scartato per identità invalida non deve riapparire come ghost object in projection, merge, UI o successiva sincronizzazione.

**MUST (distinzione di boundary):** la quarantena Zod serve a produrre viste transitorie sicure da input non autorevoli, non è autorizzazione a risigillare un Local Envelope IndexedDB autenticato dopo avere perso dati. Nel vault corrente, se `data`, `baseline` o uno snapshot di recupero subiscono una normalizzazione con perdita, lettura e scrittura si fermano preservando il ciphertext originario; la riapertura di dati validi richiede recupero esplicito e non una cancellazione silenziosa. Il controllo non cambia il comportamento di `UserDataSchema` per ingressi transitori.

### Cache corrotta vs dati cloud invalidi

- **Cache corrotta:** non reinterpretare bytes/versioni incompatibili come dati correnti; preservare il dato recuperabile quando previsto dal boundary.
- **Dati cloud critici invalidi:** non sovrascrivere il cloud con default inventati; propagare/classificare l'errore.
- **MUST:** prima di considerare autorevole un documento root letto dal cloud, confrontare i campi business originali con la normalizzazione Zod/root proiettata usando `assertCloudBusinessPreserved()`; un campo perso, una collezione scartata o un valore sostituito da fallback blocca hydration/checkpoint/guest merge senza modificare la copia cloud o il journal locale.

Il controllo è condiviso con `transactionWriter.ts`, che lo applica prima delle write semantiche. Le conversioni scalari comprovabilmente reversibili restano consentite.
- **MUST:** dopo il merge semantico, `transactionWriter` verifica nuovamente con `assertCloudBusinessPreserved()` che la normalizzazione finale non perda o sostituisca valori business. Validare il remoto iniziale non prova la validità del risultato delle operazioni. Un fallimento impedisce l'intero commit business/control; il journal locale non viene acknowledged.

- **MUST:** `TransactionOutcome.documents` restituisce **in memoria e in chiaro** il business normalizzato che è stato passato a `sealCloudDocument()` e cifrato nella transazione; non contiene ciphertext Firestore. I metadati causali scritti sono restituiti separatamente in `TransactionOutcome.syncMeta`. L'ACK deve usare questi stessi documenti normalizzati e metadati; lo snapshot precedente alla normalizzazione non è una prova valida.
- **MUST:** un `activeWorkout` cloud non nullo ma privo di identità valida è un errore di integrità, mai un'autorizzazione a cancellare la sessione corrente.
- **Versioni future:** fail-closed / `update-required` secondo `storage-and-sync.md`.

## Valori opzionali Firestore — policy `undefined` vs `null`

**MUST:** nessun `undefined` nei payload Firestore.

Ogni boundary di projection deve produrre una rappresentazione coerente:

- `null` quando il contratto root rappresenta esplicitamente l'assenza;
- chiave omessa dove il contratto lo prevede;
- mai affidarsi a `undefined` perché Firebase SDK lo rifiuta.

`documentProjection.ts` applica `removeUndefinedValuesForFirestore()` prima delle write; anche `transactionWriter.ts` lo usa prima di inviare i documenti normalizzati. Il boundary rifiuta riferimenti circolari, preserva i riferimenti condivisi aciclici e le chiavi proprie speciali come `__proto__`, senza mutare gli originali. Non costituisce da solo una validazione completa dei tipi accettati da Firestore.

## Invariante di modifica — nuova chiave cloud-root

Per ogni nuovo campo business del root cifrato Firestore verificare e aggiornare, dove applicabile:

1. `src/types.ts` — tipo applicativo;

2. `src/lib/schema.ts` / `src/lib/schemas/*.ts` — Zod;

3. `src/lib/sync/documentProjection.ts` — `rootKeys`, projection e hydration root;

4. `src/contexts/AuthContext.tsx` e `src/contexts/auth/bootstrapAuthenticatedSession.ts`, `loadAuthenticatedData.ts`, `migrateGuestAccount.ts` — orchestrazione, bootstrap/hydration e merge guest→account quando il campo partecipa a quei flussi;

5. `src/lib/db.ts` e moduli DB correlati — boundary Firestore;

6. `firestore.rules` — verificare soltanto eventuali effetti sui vincoli **esterni al ciphertext** (shape `_sealed`, `_sync` pubblico, owner/consenso, versione); non aggiungere validazione del campo business invisibile alle Rules;

7. `tests/firestore_security_rules.test.ts` — testare l'envelope e i confini di autorizzazione, insieme ai test Zod/projection/integrità per il nuovo campo business;

8. merge/import/export e backup (`src/lib/merge.ts`, `src/lib/export.ts` e moduli correlati);

9. semantic projection/path ownership se il campo è mutabile tramite Domain Operations;

10. controlli di dimensione del documento e test di regressione pertinenti.

**MUST:** non assumere che aggiungere un campo a `UserDataSchema` lo renda automaticamente cloud-root. Se manca da `rootKeys`, non verrà proiettato nel documento root dalle semantic write correnti.

**MUST:** un campo local-only non va aggiunto a Rules/root projection soltanto perché è parte di `UserData`.

## Shard mensili

I dati ad alta cardinalità sono organizzati per mese:

- `history` → `history_months/{YYYY-MM}`;
- `nutrition` → `nutrition_months/{YYYY-MM}`.

Il mese deriva dalla data locale della registrazione. Hydration parziale/completa e merge dei mesi seguono gli invarianti di `.agents/rules/storage-and-sync.md`; non trattare un mese non caricato come mese vuoto.

### Integrità dei documenti mensili

`src/lib/sync/monthlyIntegrity.ts` è il boundary condiviso dalla scansione completa in `src/lib/db.ts` e dalle letture per finestra in `src/lib/db/db_training.ts` e `src/lib/db/db_nutrition.ts`.

- **MUST:** ogni shard cloud corrente viene prima autenticato e decifrato mediante `readAccountCloudDocument()` → `openCloudDocument()` usando la ADK dell'account e la verifica di versione AEAD, poi validato con gli schema e con `requireCompleteHistoryMonthDocument()` / `requireCompleteNutritionMonthDocument()`. Il precedente percorso di normalizzazione plaintext `normalizeCloudDocument()` non è un'alternativa ammessa per la lettura cloud corrente. Versioni future o incompatibili falliscono chiuse, non diventano mesi vuoti.
- **MUST:** `sanitizeHistoryMonthDocument()` ammette solo record con chiave e ID business validi/coerenti e data canonica appartenente al mese richiesto; `sanitizeNutritionMonthDocument()` ammette solo giornate con chiave data canonica del mese e `day.date` identica alla chiave.

Le voci invalide sono scartate, senza inventare identità o spostare silenziosamente dati tra mesi.
- **MUST:** una lettura cloud ordinaria, una scansione integrale (`allMonths`) o un backup completo che incontrano record mensili scartabili devono fallire prima di pubblicare uno shard incompleto: i sanitizzatori tolleranti restano per recovery/quarantena esplicita, non per attestare che il mese remoto è completo. Nessun record invalido può diventare una cancellazione implicita. I messaggi diagnostici indicano mese e chiave (mai il payload salute).

Conservare nel `cloudDocuments` i metadati causali `_sync` dei documenti validi; `assertHistoryMonthDocument()` e `assertNutritionMonthDocument()` proteggono i percorsi di scrittura.
- **MUST:** anche dopo la verifica di completezza, confrontare i record mensili raw con quelli normalizzati usando `assertCloudBusinessPreserved()`; date/ID integri non bastano se un valore business annidato viene silenziosamente sostituito o perso.

Applicare lo stesso contratto alla finestra mensile e a `allMonths`, prima di pubblicare qualsiasi snapshot autorevole.
- **MUST:** preservare la validazione finale `DomainParsers.parseHistory()` e `DomainParsers.parseNutrition()` nel caricamento cloud, oltre al gateway `UserDataSchema` nell'hydration/commit locale. `parseNutrition()` rifiuta chiavi data non canoniche e `day.date` incoerenti prima di costruire lo stato autorevole, senza trattare chiavi speciali come proprietà del prototipo. Gli oggetti Firestore intermedi restano non attendibili anche se hanno tipi TypeScript.

**MUST:** un mese non caricato, un documento assente e una voce scartata per integrità sono casi distinti; nessuno giustifica da solo una cancellazione cloud o la sostituzione distruttiva di mesi locali. Rimangono obbligatori la copertura `window`/`all`, il journal e il replay causale. Ogni modifica di questi boundary richiede regressioni per dati incompleti, date/mese incoerenti, versioni future, fallimenti e retry.

## Domain Operations

La classificazione storage non cambia il mutation boundary M8. Le normali mutazioni business UI/hook devono usare Domain Operations; snapshot-save resta confinato ai boundary bulk/recovery supportati e allowlisted in `.agents/rules/domain-operations.md`.

## Limiti dei cicli di allenamento

La forma persistita `TrainingCycleSchema` resta tollerante per leggere e conservare cicli importati o già presenti senza eliminarli a causa di un solo numero fuori limite. Le nuove scritture tramite `training-cycle.upsert` validano invece **prima di qualsiasi fallback** settimane intere fra 1 e 52 e sedute settimanali intere fra 1 e 14, con `TrainingCycleWriteSchema` e un controllo dell'input raw in `src/lib/sync/domainOperations/reducer.ts`. Non trasformare un valore invalido in una correzione silenziosa durante il commit.

Anche la validazione diretta con `TrainingCycleWriteSchema` deve respingere valori raw non validi, ID mancanti/duplicati e frequenze difettose **prima** dei fallback Zod, senza convertire una scrittura malformata in un ciclo plausibile. Le frequenze delle routine nei nuovi upsert del ciclo e della singola routine devono essere interi positivi non superiori a 14, prima dei fallback Zod; quando il totale settimanale non è esplicito, la somma delle frequenze non deve superare 14. La lettura di cicli già memorizzati resta tollerante senza riscritture.
 
Le anteprime dell'editor hanno gli stessi limiti di lavoro ma lasciano visibile l'input originale finché non viene corretto. `calculateCycleSchedule`, `calculateCycleTimeline` e `getNextScheduledRoutine` non elaborano quantità malformate o superiori a 104 settimane/14 sedute; il limite storico di 104 conserva la possibilità di leggere cicli di 100 settimane già coperti dai test. In caso di dati non sicuri, evitare di generare sessioni; non cancellare o riscrivere il ciclo persistito. Ogni modifica a queste soglie richiede test di lettura, scrittura, import ed editor.

## Nuove scritture di alimenti custom

Il boundary `validateCustomFood` in `src/lib/calc/nutrition.ts`, usato dal flusso `useNutritionMeals`, valida gli input raw prima della write durevole: numeri richiesti interamente interpretabili e finiti, nutrienti non negativi e quantità base positiva. Anche i campi nutrizionali facoltativi, se compilati, devono contenere numeri validi e non possono essere scartati in silenzio; un campo vuoto continua a essere facoltativo. Un prefisso numerico seguito da testo non è un numero valido; la virgola decimale UI è normalizzata. Per unità a pezzo (`pezzo`/`pcs`) serve il peso reale positivo del pezzo, senza inventare una conversione. Input non valido lascia il form e non invia Domain Operations; i test devono provare anche questo boundary, non soltanto il calcolo successivo.
