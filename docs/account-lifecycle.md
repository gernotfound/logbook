# Ciclo di vita account — LogBook

> Ultima verifica del codice: 2026-09-11. Implementazione sul branch di correzione audit, non pubblicata. Esiti e limiti di test in `remediation_logbook_2026.md`.

## Backup JSON e importazione

`src/lib/backup.ts` definisce il formato `logbook-backup`, versione 2: owner, data di esportazione, copertura, intero `UserData` e recovery locale. `src/lib/db/backupSnapshot.ts` legge il profilo e tutte le pagine dello storico/nutrizione dal server (50 documenti per pagina), poi confronta cloud, baseline e ultima revisione locale. Gli originali cloud e il registro locale sono inclusi nella sezione recovery.

La lettura di tutti i documenti non costituisce uno snapshot atomico fra dispositivi. Il file registra inizio/fine lettura; con modifiche concorrenti può essere necessario ripetere l'esportazione. Un errore di rete non produce un backup dichiarato completo: l'utente può scegliere esplicitamente la copia del solo dispositivo, marcata `device`.

Il formato v1 ordinario e quello d'emergenza sono importabili. I formati senza owner richiedono conferma esplicita della provenienza; i backup di un altro account sono rifiutati anche in modalità guest.

- **Importa JSON:** unione incrementale senza mutazioni in place. Le collisioni mantengono il valore locale; i campi mancanti vengono aggiunti. I totali delle giornate con nuovi pasti sono ricalcolati.
- **Ripristina:** sostituisce i campi presenti nel file rispetto allo stato locale disponibile. Un vecchio backup parziale non azzera i campi che omette. Il writer cloud conserva comunque dati remoti mai caricati; non equivale a cancellare e ricreare l'intero account.
- Un'anteprima espone dimensione del risultato e collisioni. Cambi di sessione o modifiche mentre l'anteprima è aperta annullano il commit.
- La conferma segue la persistenza locale; offline il messaggio indica che il cloud è ancora in attesa.
- I consensi importati non sostituiscono l'accettazione corrente.
- La recovery conserva anche bozze e alternative ai conflitti. Il ripristino guidato di questi dati aggiuntivi è ancora da completare; il file originale va conservato.

La vecchia cache senza owner viene copiata senza sovrascrivere un archivio recovery già presente. “Esporta archivio precedente” rende disponibile il file per recupero esplicito. Le vecchie credenziali/code REST non vengono riprodotte o esportate.

## Esportazione CSV

`Exporter.exportToCSV` genera `allenamenti.csv` (serie, dropset, isometrie) e `misurazioni.csv` (peso, macro, circonferenze e sonno) dal dataset disponibile in memoria. Il CSV non ha la completezza del nuovo percorso JSON cloud paginato.

- **MUST:** I CSV includono il BOM UTF-8 per compatibilità Excel. Markdown, sorgenti e JSON restano UTF-8 senza BOM.
- **MUST:** Nuove metriche da esportare devono essere mappate esplicitamente.

## Eliminazione account

`useSettings` chiede due conferme e riautentica Google prima di invocare `DB.deleteAccount`. Il DB verifica autonomamente il tempo di autenticazione nel token aggiornato prima di ogni operazione distruttiva; per altri provider può essere necessario ripetere il login.

Il flusso client:

1. Scrive un marker persistente di cancellazione per owner, invalida l'epoch e arresta nuovi writer.
2. Attende la conclusione della replica precedente e delle scritture SDK pendenti. Un timeout interrompe la procedura prima del passo successivo; non cancella la Promise SDK.
3. Legge dal server ed elimina pagine da 400 delle cinque raccolte private: storico, nutrizione, errori, eventi, anomalie.
4. Rilegge sempre la prima pagina dopo un batch confermato: un'interruzione è riprendibile senza cursor perso.
5. Elimina il profilo e verifica sul server assenza del root e di residui nelle cinque raccolte.
6. Solo dopo queste verifiche chiama `deleteUser`; soltanto dopo il successo Auth purga il locale e resetta lo store.

**MUST:** Nessun `permission-denied` viene interpretato come raccolta vuota o successo. Query, batch o verifica falliti mantengono account e copia locale e mostrano un errore di cancellazione incompleta. I batch già riusciti non sono reversibili; riprendere la cancellazione dalle impostazioni.

Il marker sospende replica e telemetria del client e rimane dopo gli errori. Al riavvio la sospensione resta attiva. I backup restano disponibili.

**Limite da risolvere prima del rilascio:** marker e verifiche client non rendono atomiche Firestore e Firebase Auth e non fermano altri dispositivi o vecchi client. Le verifiche residuali riducono il rischio, ma serve coordinamento server per una garanzia globale. La UI chiede di chiudere gli altri dispositivi. Non presentare questo flusso come una cancellazione server atomica.

## Logout e pulizia locale

`secureLogOut` propaga un errore di `auth.signOut` e conserva il locale. Dopo sign-out riuscito, purga l'archivio dell'owner catturato prima del logout. Gli archivi v2 degli altri utenti restano separati.

`purgeAllLocalUserData` tenta ogni rimozione e rigetta con un errore aggregato se alcune falliscono: la UI comunica la pulizia incompleta. Il registro di avanzamento tiene aperte le questioni di purge della telemetria e di attribuzione degli archivi legacy.

**MUST:** Non eliminare la cache del service worker durante logout: contiene gli asset necessari all'avvio offline.

## Guest e aggiornamenti

La modalità guest ha archivio e workout separati dagli utenti. La migrazione conserva la copia guest e registra il risultato locale prima della replica. Le callback vecchie sono invalidate tramite owner ed epoch.

Gli aggiornamenti PWA sono differibili. Prima del reload: flush delle bozze, attesa dei salvataggi, confronto fra store e copia IndexedDB e snapshot sincrono del workout. Errori locali bloccano il reload. Un errore di caricamento chunk apre lo stesso prompt; non scatena più un reload automatico che può ripetersi.
