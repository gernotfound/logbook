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
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Aggiornata al 23 settembre 2026
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
          fontSize: '0.95rem',
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
              La telemetria tecnica propria può essere accodata localmente quando non esiste una sessione Firebase autenticata, ma gli elementi privi di UID autenticato non vengono caricati successivamente su Firestore come dati dell'account. Se abiliti volontariamente le statistiche di utilizzo dalle Impostazioni, anche in modalità ospite possono invece essere attivati i servizi Analytics descritti più avanti. L'uso locale dei dati fitness e l'opt-in Analytics sono quindi flussi distinti.
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
              LogBook utilizza una telemetria tecnica propria per diagnosticare errori e problemi di stabilità. Per gli utenti autenticati questa telemetria può essere <strong style={{ color: 'var(--text-main)' }}>pseudonimizzata tramite l'UID tecnico Firebase</strong> e può includere un identificativo di sessione, versione dell'app, piattaforma derivata, modalità PWA/browser, stato online, tipo e messaggio di errore sanitizzati, contatori/timestamp e stack trace troncati e sanitizzati.
            </p>
            <p>
              Alcuni eventi operativi includono inoltre metadati tecnici limitati del flusso di allenamento, ad esempio stato offline, identificativo tecnico della routine avviata, durata della sessione e numero di esercizi. Il nome scelto dall'utente per la routine non viene conservato nella coda telemetrica né inviato a Firestore. Non vengono inviati tramite questa telemetria serie, carichi, ripetizioni, note di sessione, diario alimentare o misurazioni corporee. I dettagli evento attraversano inoltre una allowlist tecnica: chiavi non previste e strutture libere vengono scartate; le stringhe ammesse vengono sanitizzate per rimuovere email, IP, token, API key, path utente e altre chiavi sensibili riconosciute.
            </p>
            <p>
              La telemetria tecnica non è quindi descritta come “anonima”: per un account autenticato può essere collegata tecnicamente a quell'account. Il suo scopo è sicurezza, affidabilità e diagnosi, non la profilazione commerciale dei dati di allenamento o nutrizione.
            </p>
          </Section>

          <Section title="Base giuridica del trattamento">
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Esecuzione del servizio</strong> (art. 6, par. 1, lett. b GDPR): per autenticazione, sincronizzazione, backup/recovery e funzionalità richieste dall'utente.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso esplicito</strong> (art. 9, par. 2, lett. a GDPR): per il trattamento dei dati relativi alla salute (categorie particolari di dati). Il consenso viene richiesto esplicitamente nell'app.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Legittimo interesse</strong> (art. 6, par. 1, lett. f GDPR): per telemetria tecnica strettamente finalizzata a sicurezza, prevenzione degli errori e stabilità del servizio, con minimizzazione e sanitizzazione.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso</strong> (art. 6, par. 1, lett. a GDPR): per Analytics e statistiche di utilizzo non essenziali.</li>
            </ul>
          </Section>

          <Section title="Analytics e tecnologie di memorizzazione locale">
            <p>
              IndexedDB e localStorage sono utilizzati per il funzionamento offline, la persistenza locale, il workout in corso, preferenze e altri stati tecnici necessari. Questi meccanismi sono distinti dai servizi Analytics e sono necessari alle funzionalità locali dell'app.
            </p>
            <p>
              <strong style={{ color: 'var(--text-main)' }}>Firebase Analytics, Vercel Analytics e Vercel Speed Insights sono disabilitati per impostazione predefinita e vengono attivati soltanto tramite opt-in nelle Impostazioni.</strong> L'opt-in può essere revocato successivamente; il codice applicativo impedisce ai consumer Firebase Analytics di ottenere un'istanza consentita quando il consenso è disattivato e non renderizza i componenti Vercel Analytics/Speed Insights senza consenso.
            </p>
            <p>
              Questi servizi sono destinati a statistiche tecniche e di utilizzo. Non li descriviamo come necessariamente anonimi: i fornitori possono trattare dati tecnici di rete/dispositivo secondo le proprie condizioni e configurazioni. LogBook non deve includere deliberatamente nei relativi eventi il contenuto grezzo di allenamenti, nutrizione o misurazioni corporee.
            </p>
          </Section>

          <Section title="Conservazione, backup e cancellazione dei dati">
            <p>
              I dati locali in modalità ospite rimangono sul dispositivo finché non vengono eliminati dall'utente, rimossi dal browser/sistema oppure migrati secondo i flussi previsti dall'app.
            </p>
            <p>
              I dati cloud e la telemetria privata associata all'account vengono conservati per fornire il servizio finché l'account rimane attivo, salvo cancellazioni o obblighi diversi applicabili. LogBook mette a disposizione backup JSON ed esportazioni CSV per consentire all'utente di conservare una copia dei propri dati.
            </p>
            <p>
              La funzione <strong style={{ color: 'var(--text-main)' }}>Elimina account</strong> avvia un workflow server-side che rimuove le raccolte private previste, i dati applicativi cloud e infine l'account Firebase Authentication. Il dispositivo conserva la propria copia locale finché non ha prova che il workflow cloud sia completato, per evitare cancellazioni locali premature in caso di rete instabile.
            </p>
            <p>
              Dopo il completamento della cancellazione, LogBook conserva temporaneamente un record tecnico server-only di recovery privo dei dati di allenamento, nutrizione e misurazioni. Il record contiene l'identificativo tecnico del job, stato/timestamp e l'hash non reversibile della ricevuta di cancellazione. Serve a permettere a un dispositivo rimasto offline di verificare che la cancellazione cloud sia realmente terminata prima di eliminare la propria copia locale. È programmato per la rimozione dopo 30 giorni e viene eliminato dal successivo ciclo giornaliero di manutenzione applicabile.
            </p>
            <p style={{ marginTop: '8px', color: 'var(--warning-color)' }}>
              <strong>Attenzione:</strong> il servizio non garantisce backup di livello enterprise. È consigliato effettuare periodicamente un backup JSON e/o un'esportazione CSV tramite le funzioni dell'app.
            </p>
          </Section>

          <Section title="Fornitori e trasferimento dei dati">
            <p>I servizi cloud dell'app si appoggiano principalmente ai seguenti fornitori:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Google / Firebase</strong> — Authentication, Firestore, App Check/reCAPTCHA Enterprise e, solo con consenso, Firebase Analytics.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Vercel</strong> — hosting delle risorse e delle funzioni server; solo con consenso, Vercel Analytics e Speed Insights.</li>
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
              <li><strong style={{ color: 'var(--text-main)' }}>Revoca del consenso</strong>: disabilitare Analytics dalle Impostazioni; per i dati di salute, la revoca non pregiudica la liceità del trattamento precedente e può richiedere l'interruzione delle funzionalità che dipendono da tali dati.</li>
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
  fontSize: '0.95rem',
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