import React, { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useScrollLock } from '../hooks/useScrollLock';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

export const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useScrollLock();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocusTrap({ containerRef: dialogRef, initialFocusRef: closeButtonRef, onEscape: onClose });
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.75)',
      zIndex: 100000,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '16px',
      overflowY: 'auto',
    }}>
      <div style={{
        backgroundColor: 'var(--surface-color)',
        border: '1px solid var(--glass-border)',
        borderRadius: '16px',
        maxWidth: '760px',
        width: '100%',
        marginTop: '24px',
        marginBottom: '24px',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 48px)',
      }}>
        {/* Header sticky */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px',
          borderBottom: '1px solid var(--glass-border)',
          backgroundColor: 'var(--surface-color)',
          borderRadius: '16px 16px 0 0',
          flexShrink: 0,
        }}>
          <div>
            <h2 id={titleId} style={{margin: 0,color: 'var(--text-main)'}}>
              Informativa sulla privacy
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-meta)', color: 'var(--text-muted)' }}>
              Aggiornata al 1 ottobre 2026
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Chiudi informativa"
            style={{ flexShrink: 0, marginLeft: '12px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body scrollabile */}
        <div style={{
          overflowY: 'auto',
          padding: '24px',
          color: 'var(--text-muted)',
          lineHeight: '1.7',
          fontSize: 'var(--font-size-body)',
        }}>
          <Section title="Titolare del trattamento">
            <p>
              Prima della distribuzione commerciale devono essere indicati qui l'identità e i recapiti del titolare del trattamento: <strong style={{ color: 'var(--text-main)' }}>[NOME / RAGIONE SOCIALE]</strong>, <strong style={{ color: 'var(--text-main)' }}>[INDIRIZZO]</strong>, <strong style={{ color: 'var(--text-main)' }}>[EMAIL PRIVACY]</strong>.
              Se LogBook viene fornito tramite una palestra, i ruoli privacy tra le parti dipendono dalle finalità e dai mezzi effettivamente determinati da ciascuna parte e devono essere definiti nella documentazione contrattuale.
            </p>
            <p>
              Il trattamento avviene nel rispetto del Regolamento Generale sulla Protezione dei Dati dell'Unione Europea (GDPR, Regolamento UE 2016/679) e della normativa nazionale applicabile.
            </p>
          </Section>

          <Section title="Che cos'è LogBook">
            <p>
              LogBook è un'applicazione web progressiva (PWA) per il tracciamento degli allenamenti, della nutrizione e di misurazioni corporee, progettata con un'architettura <em>offline-first</em>.
            </p>
            <p>
              <strong style={{ color: 'var(--text-main)' }}>Limitazione d'età:</strong> il servizio è destinato esclusivamente a utenti maggiorenni (18+). Non raccogliamo intenzionalmente dati di minori. Se sei un minore, non utilizzare il servizio.
            </p>
          </Section>

          <Section title="Dati trattati e finalità">
            <h3 style={h3Style}>Modalità ospite (senza account)</h3>
            <p>
              I dati business inseriti nell'app — come allenamenti, nutrizione, misurazioni, routine e pianificazioni — restano nella persistenza locale del dispositivo e non vengono sincronizzati su Firestore finché non colleghi un account.
            </p>
            <p>
              La telemetria tecnica degli errori non viene inviata a Sentry quando non esiste una sessione Firebase autenticata. Eventuali elementi diagnostici best-effort possono restare localmente sul dispositivo senza essere riassegnati a un account successivo. Google Analytics resta disattivato finché non abiliti volontariamente “Statistiche di utilizzo” nelle Impostazioni.
            </p>

            <h3 style={h3Style}>Modalità cloud (con account)</h3>
            <p>
              Se scegli di creare o collegare un account, i dati applicativi vengono sincronizzati su Firebase Firestore. A seconda del metodo di autenticazione possono essere trattati l'identificativo Firebase dell'account, l'indirizzo email e gli eventuali dati di profilo restituiti dal provider di autenticazione.
            </p>
            <ul style={ulStyle}>
              <li>Dati di allenamento: routine, sessioni, esercizi, serie, carichi, ripetizioni, RPE e informazioni correlate.</li>
              <li>Dati di nutrizione: pianificazioni, alimenti, macro, diario e integrazione.</li>
              <li><strong style={{ color: 'var(--primary-color)' }}>Dati relativi alla salute (Art. 9 GDPR):</strong> peso, composizione corporea, circonferenze, sonno, fatica/dolori e altre misurazioni o annotazioni di salute inserite nell'app.</li>
              <li>Metadati tecnici necessari a sincronizzazione, versioning, recovery, consenso legale e gestione del ciclo di vita dell'account.</li>
            </ul>
            <p>
              I dati cloud sono conservati nell'area privata associata all'account e sono protetti dalle regole di sicurezza applicative. Il backend amministrativo mantiene capacità tecniche necessarie a gestione, sicurezza, recovery e cancellazione account; tali capacità non sono destinate a profilazione commerciale dei dati fitness.
            </p>
            <p>
              Nell'architettura attuale LogBook non prevede ruoli palestra, coach o amministratore con accesso ai dati degli iscritti: una palestra che rende disponibile il servizio ai propri iscritti non riceve per questo motivo accesso ai loro dati in LogBook. Qualsiasi futura funzione di condivisione richiederà una specifica modifica del prodotto e della relativa informativa.
            </p>

            <h3 style={h3Style}>Telemetria tecnica di stabilità</h3>
            <p>
              LogBook utilizza Sentry Error Monitoring per diagnosticare errori e anomalie tecniche in Production. L'app <strong style={{ color: 'var(--text-main)' }}>non allega deliberatamente a Sentry l'UID Firebase, l'indirizzo email o i contenuti business dell'utente</strong>. Il payload applicativo è limitato a un identificativo tecnico di sessione, versione e SHA della build, piattaforma derivata, modalità PWA/browser, stato online, sorgente dell'errore, contatori/timestamp e messaggio/stack trace sanitizzati e limitati.
            </p>
            <p>
              Prima dell'invio, LogBook applica filtri che rimuovono pattern riconosciuti di email, indirizzi IP presenti nel testo, token, API key, path utente e altre chiavi sensibili. Sentry è inoltre configurato senza invio predefinito di PII. Il fornitore può comunque ricevere metadati tecnici di rete necessari alla comunicazione secondo il proprio servizio e le relative condizioni.
            </p>
            <p>
              LogBook usa Sentry soltanto per <strong style={{ color: 'var(--text-main)' }}>Error Monitoring</strong>: non abilita Session Replay, tracing, logging, Application Metrics o tracking proprietario di avvio/salvataggio workout e funnel di installazione PWA. Gli errori identici vengono deduplicati lato app per ridurre raccolta e volume.
            </p>

            <h3 style={h3Style}>Statistiche di utilizzo opzionali</h3>
            <p>
              <strong style={{ color: 'var(--text-main)' }}>Google Analytics for Firebase è disattivato per impostazione predefinita e non viene inizializzato finché non fornisci un opt-in esplicito nelle Impostazioni.</strong> La preferenza può essere revocata in qualsiasi momento ed è separata dal precedente consenso Vercel Analytics, che non viene riutilizzato per autorizzare Google Analytics.
            </p>
            <p>
              Dopo l'opt-in, LogBook consente la misurazione standard di pagina/sessione GA4 necessaria a comprendere l'utilizzo generale dell'app. La Misurazione avanzata della Web data stream (scroll, clic in uscita, ricerca sito, download, interazioni con moduli e video) non fa parte del target iniziale. Il codice non imposta UID Firebase, email o proprietà utente Analytics e non invia eventi personalizzati contenenti allenamenti, nutrizione, misurazioni o altri dati di salute. Le categorie di consenso pubblicitario restano negate e le opzioni Google Signals e personalizzazione pubblicitaria sono disabilitate. Google può comunque trattare dati tecnici del browser/dispositivo, identificatori o informazioni di rete necessari al servizio secondo la configurazione e le condizioni applicabili.
            </p>
          </Section>

          <Section title="Base giuridica del trattamento">
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Esecuzione del servizio</strong> (art. 6, par. 1, lett. b GDPR): per autenticazione, sincronizzazione, backup/recovery e funzionalità richieste dall'utente.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso esplicito</strong> (art. 9, par. 2, lett. a GDPR): per il trattamento dei dati relativi alla salute (categorie particolari di dati). Il consenso viene richiesto esplicitamente nell'app.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso</strong> (art. 6, par. 1, lett. a GDPR): per Google Analytics, che è non essenziale, disabilitato per default e revocabile dalle Impostazioni.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Legittimo interesse</strong> (art. 6, par. 1, lett. f GDPR): per telemetria tecnica strettamente finalizzata a sicurezza, prevenzione degli errori e stabilità del servizio, con minimizzazione e sanitizzazione.</li>
            </ul>
          </Section>

          <Section title="Tecnologie di memorizzazione locale">
            <p>
              IndexedDB e localStorage sono utilizzati per il funzionamento offline, la persistenza locale, il workout in corso, preferenze e altri stati tecnici necessari. La preferenza Google Analytics è memorizzata localmente ed è disabilitata per default. Solo dopo opt-in Google Analytics può utilizzare le tecnologie di misurazione previste dal servizio; la revoca disabilita la raccolta applicativa successiva. Vercel Analytics e Speed Insights non fanno parte del target Firebase.
            </p>
          </Section>

          <Section title="Conservazione, backup e cancellazione dei dati">
            <p>
              I dati locali in modalità ospite rimangono sul dispositivo finché non vengono eliminati dall'utente, rimossi dal browser/sistema oppure migrati secondo i flussi previsti dall'app.
            </p>
            <p>
              I dati applicativi cloud associati all'account vengono conservati per fornire il servizio finché l'account rimane attivo, salvo cancellazioni o obblighi diversi applicabili. Per Sentry e Google Analytics, i tempi di conservazione dipendono dal piano e dalla configurazione effettiva dei rispettivi fornitori e devono essere verificati rispetto alle condizioni correnti prima del go-live. La revoca di Google Analytics impedisce la nuova raccolta applicativa, ma non equivale automaticamente alla cancellazione retroattiva dei dati già trattati secondo le impostazioni di retention applicabili. Le vecchie raccolte telemetriche Firestore generate da versioni precedenti di LogBook mantengono invece la retention tecnica di 30 giorni e vengono progressivamente eliminate dal processo server di manutenzione. LogBook mette a disposizione backup JSON ed esportazioni CSV per consentire all'utente di conservare una copia dei propri dati.
            </p>
            <p>
              La funzione <strong style={{ color: 'var(--text-main)' }}>Elimina account</strong> avvia un workflow server-side che rimuove le raccolte private previste, i dati applicativi cloud e infine l'account Firebase Authentication. Il dispositivo conserva la propria copia locale finché non ha prova che il workflow cloud sia completato, per evitare cancellazioni locali premature in caso di rete instabile.
            </p>
            <p>
              Dopo il completamento della cancellazione, LogBook conserva temporaneamente un record tecnico server-only di recovery privo dei dati di allenamento, nutrizione e misurazioni. Il record contiene l'identificativo tecnico del job, stato/timestamp e gli hash non reversibili delle ricevute di cancellazione autorizzate sui dispositivi che hanno avviato o ripreso il workflow. Serve a permettere a un dispositivo rimasto offline di verificare che la cancellazione cloud sia realmente terminata prima di eliminare la propria copia locale. È programmato per la rimozione dopo 30 giorni e viene eliminato dal successivo ciclo giornaliero di manutenzione applicabile.
            </p>
            <p style={{ marginTop: '8px', color: 'var(--warning-color)' }}>
              <strong>Attenzione:</strong> il servizio non garantisce backup di livello enterprise. È consigliato effettuare periodicamente un backup JSON e/o un'esportazione CSV tramite le funzioni dell'app.
            </p>
          </Section>

          <Section title="Fornitori e trasferimento dei dati">
            <p>I servizi cloud dell'app si appoggiano principalmente ai seguenti fornitori:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Google / Firebase</strong> — Authentication, Firestore, App Check/reCAPTCHA Enterprise, Hosting, Cloud Functions e, soltanto dopo opt-in, Google Analytics for Firebase per statistiche di utilizzo.</li>

              <li><strong style={{ color: 'var(--text-main)' }}>Sentry</strong> — Error Monitoring tecnico in Production e gestione delle source map necessarie a ricostruire gli stack trace; LogBook non abilita Replay, tracing, logging o metriche Sentry.</li>
            </ul>
            <p>
              Prima della distribuzione commerciale devono essere verificati e pubblicati l'elenco aggiornato dei fornitori/sub-responsabili, le localizzazioni effettive del trattamento e, per eventuali trasferimenti fuori dallo SEE, il meccanismo applicabile (ad esempio decisione di adeguatezza o clausole contrattuali standard).
            </p>
          </Section>

          <Section title="I tuoi diritti (GDPR)">
            <p>Nei limiti e alle condizioni previste dalla normativa applicabile, puoi esercitare i diritti riconosciuti dal GDPR, inclusi:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Accesso e portabilità</strong>: usare backup JSON/esportazione CSV e richiedere le informazioni applicabili al trattamento.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Rettifica</strong>: correggere i dati modificabili tramite l'app.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Cancellazione</strong>: avviare la funzione di eliminazione account per la rimozione dei dati cloud applicativi.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Revoca del consenso</strong>: per i dati di salute, la revoca non pregiudica la liceità del trattamento precedente e può richiedere l'interruzione delle funzionalità che dipendono da tali dati; per Google Analytics puoi revocare separatamente l'opt-in dalle Impostazioni senza perdere le funzioni essenziali di LogBook.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Limitazione/opposizione</strong>: quando applicabile rispetto alla specifica base giuridica e al trattamento interessato.</li>
            </ul>
            <p>
              Per richieste che non possono essere gestite direttamente dall'app utilizza il contatto privacy <strong style={{ color: 'var(--text-main)' }}>[EMAIL PRIVACY]</strong>. Hai inoltre il diritto di proporre reclamo al Garante per la protezione dei dati personali.
            </p>
          </Section>

          <Section title="Modifiche alla presente informativa">
            <p>
              La presente informativa può essere aggiornata quando cambiano funzionalità, fornitori, basi giuridiche o flussi di dati. Le modifiche materiali comportano l'incremento della versione privacy dell'app e la richiesta di accettazione della versione aggiornata quando previsto dal flusso di consenso.
            </p>
          </Section>

          <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid var(--glass-border)', textAlign: 'center' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Chiudi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Componenti e stili di supporto ---

const h3Style: React.CSSProperties = {
  color: 'var(--primary-color)',
  fontSize: 'var(--font-size-body)',
  fontWeight: 600,
  marginTop: '16px',
  marginBottom: '6px',
};

const ulStyle: React.CSSProperties = {
  paddingLeft: '20px',
  marginTop: '8px',
  marginBottom: '8px',
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: '28px' }}>
    <h3 style={{color: 'var(--text-main)',fontWeight: 700,
      marginTop: 0,
      marginBottom: '10px',
      paddingBottom: '6px',
      borderBottom: '1px solid var(--glass-border)'}}>
      {title}
    </h3>
    {children}
  </div>
);