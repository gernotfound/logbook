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
              Aggiornata al 6 novembre 2026
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
              Il titolare del trattamento è <strong style={{ color: 'var(--text-main)' }}>Gerardo Califano</strong>, persona fisica che gestisce TheLogBook come progetto amatoriale. Per richieste sul trattamento dei dati personali puoi scrivere a <a href="mailto:thelogbook.privacy@gmail.com">thelogbook.privacy@gmail.com</a>.
              Un'eventuale futura distribuzione tramite palestre richiederebbe una valutazione specifica dei ruoli privacy tra le parti e della relativa documentazione contrattuale.
            </p>
            <p>
              TheLogBook è destinato attualmente all'uso gratuito da parte di persone maggiorenni. Non è un servizio sanitario e non è gestito da una palestra.
            </p>
          </Section>

          <Section title="Che cos'è TheLogBook">
            <p>
              TheLogBook è un'applicazione web progressiva (PWA) per il tracciamento degli allenamenti, della nutrizione e di misurazioni corporee, progettata con un'architettura <em>offline-first</em>.
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
              TheLogBook non integra servizi di analytics di utilizzo e non invia automaticamente report degli errori del browser a fornitori esterni. Gli eventuali messaggi di errore dell'app rimangono sul dispositivo.
            </p>

            <h3 style={h3Style}>Modalità cloud (con account)</h3>
            <p>
              Se scegli di creare o collegare un account, i dati applicativi vengono sincronizzati su Firebase Firestore. A seconda del metodo di autenticazione possono essere trattati l'identificativo Firebase dell'account, l'indirizzo email e gli eventuali dati di profilo restituiti dal provider di autenticazione.
            </p>
            <ul style={ulStyle}>
              <li>Dati di profilo inseriti volontariamente: data di nascita, altezza, genere e misure corporee.</li>
              <li>Dati di allenamento: routine, sessioni, esercizi, serie, carichi, ripetizioni, RIR (ripetizioni in riserva), valutazioni pre-sessione (stress, energia, umore, recupero) e informazioni correlate.</li>
              <li>Dati di nutrizione: pianificazioni, alimenti, macro, diario e integrazione.</li>
              <li><strong style={{ color: 'var(--primary-color)' }}>Dati che possono rientrare nelle categorie particolari (art. 9 GDPR):</strong> peso, composizione corporea, circonferenze, sonno, fatica/dolori e altre misurazioni o annotazioni che, per contenuto e contesto, rivelano informazioni sulla salute.</li>
              <li>Metadati tecnici necessari a sincronizzazione, versioning, recovery, consenso legale e gestione del ciclo di vita dell'account.</li>
            </ul>
            <p>
              I dati cloud sono conservati nell'area privata associata all'account e sono protetti dalle regole di sicurezza applicative. I dati business sincronizzati sono cifrati, ma questa protezione non è end-to-end: i servizi server autorizzati possono gestire le chiavi necessarie a recovery, esportazione e cancellazione. L'account richiede la verifica dell'indirizzo email prima dell'accesso ai dati cloud. Le capacità amministrative tecniche non sono destinate a profilazione commerciale dei dati fitness.
            </p>
            <p>
              Nessun altro utente, palestra o allenatore dispone nell'app di un accesso ai dati del tuo account. I servizi tecnici autorizzati possono intervenire per la gestione e la sicurezza del servizio.
            </p>

            <h3 style={h3Style}>Gestione tecnica degli errori</h3>
            <p>
              TheLogBook gestisce nel browser errori, interruzioni della sincronizzazione e problemi dell'archivio locale per mostrare avvisi e impedire operazioni non sicure. Non utilizza un servizio esterno di Error Monitoring e non crea code di report diagnostici destinate all'invio automatico.
            </p>
            <p>
              Anche senza un account, il caricamento dell'app e i controlli tecnici possono comportare richieste ai servizi Firebase/Google. Firebase Hosting, Authentication, App Check/reCAPTCHA Enterprise e le API trusted Vercel, quando usati, possono trattare dati tecnici di rete e generare log presso i fornitori. Questi trattamenti sono distinti dai dati fitness, che in modalità ospite non vengono sincronizzati automaticamente. La rimozione del monitoraggio degli errori dal client non elimina i log necessari ai servizi.
            </p>
          </Section>

          <Section title="Base giuridica del trattamento">
            <p>
              Per fornire le funzioni richieste e gestire l'account, TheLogBook tratta i dati necessari all'esecuzione del servizio (art. 6, par. 1, lett. b GDPR). Per le informazioni che rivelano dati sulla salute, l'app richiede inoltre il consenso esplicito dell'interessato (art. 9, par. 2, lett. a GDPR). Il consenso può essere revocato dalle impostazioni in qualsiasi momento.
            </p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Esecuzione del servizio</strong> (art. 6, par. 1, lett. b GDPR): per autenticazione, sincronizzazione, backup/recovery e funzionalità richieste dall'utente.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso esplicito</strong> (art. 9, par. 2, lett. a GDPR): condizione prevista per i dati che rivelano informazioni sulla salute. Tale condizione si aggiunge alla base giuridica applicabile ai sensi dell'art. 6, non la sostituisce. L'app richiede una scelta separata e, se non viene prestata, le funzioni fitness non sono accessibili.</li>
            </ul>
          </Section>

          <Section title="Dati necessari e facoltativi"> 
            <p>
              Per usare un account è necessario disporre delle informazioni richieste dal metodo di autenticazione scelto e completare la verifica dell'email. Allenamenti, alimenti, misurazioni e annotazioni sono inseriti dall'utente in base alle funzioni che decide di usare; non occorre compilare tutte le misurazioni. Il consenso separato ai trattamenti dei dati salute è attualmente richiesto per accedere alle funzioni fitness: in assenza del consenso puoi consultare i documenti e usare gli strumenti disponibili per i diritti, l'esportazione e la cancellazione.
            </p>
          </Section>

          <Section title="Tecnologie di memorizzazione locale">
            <p>
              IndexedDB e localStorage sono utilizzati per il funzionamento offline, la persistenza locale, i workout in corso e le preferenze tecniche. TheLogBook non integra Google Analytics 4, Firebase Analytics, Vercel Analytics o Speed Insights e non invia eventi di utilizzo a tali servizi. I servizi necessari di autenticazione e protezione anti-abuso possono utilizzare propri identificatori tecnici secondo le rispettive condizioni.
            </p>
            <p>
              Gli archivi locali principali dei dati fitness e le bozze del dispositivo sono protetti con cifratura autenticata. Le chiavi sono conservate nello stesso profilo del browser: questa protezione non impedisce l'accesso a chi compromette il profilo o esegue codice malevolo nell'app, e non costituisce cifratura end-to-end. I file JSON e CSV esportati sono invece leggibili in chiaro.
            </p>
          </Section>


          <Section title="Revoca del consenso per i dati salute">
            <p>
              Puoi revocare il consenso da Impostazioni → Privacy. Prima della conferma TheLogBook ti offre, senza obbligarti, l'esportazione di un backup JSON dei tuoi dati. Se non esporti, o se l'esportazione fallisce, puoi comunque revocare il consenso.
            </p>
            <p>
              La revoca sospende immediatamente allenamenti, nutrizione, diario e tutte le funzioni fitness. Per un account, quando il server registra la revoca, avvia automaticamente la cancellazione dei dati applicativi (profilo fitness, misurazioni, allenamenti, nutrizione, schede e raccolte correlate). Non occorre inviare una seconda richiesta di cancellazione. L'account Firebase Authentication rimane esistente; puoi scegliere separatamente di eliminarlo.
            </p>
            <p>
              In assenza di connessione la revoca sospende subito le funzioni sul dispositivo, ma resta in attesa di registrazione e cancellazione cloud; al ritorno online il servizio tenta la riconciliazione. Se un job di cancellazione è interrotto, il sistema può riprenderlo; la cancellazione non è dichiarata completata fino alla verifica del server e delle copie locali accessibili. Non è possibile cancellare da remoto file JSON/CSV già esportati né copie su dispositivi che non tornano online.
            </p>
            <p>
              In modalità ospite la revoca elimina l'archivio locale e termina la sessione ospite, senza creare alcun account. Dopo la cancellazione, un nuovo consenso consente di ricominciare con dati nuovi: i dati cancellati non possono essere ripristinati da una vecchia copia o backup. La revoca non pregiudica la liceità del trattamento precedente.
            </p>
          </Section>

          <Section title="Conservazione, backup e cancellazione dei dati">
            <p>
              I dati applicativi sono conservati durante l'uso autorizzato del servizio. Alla revoca del consenso per la salute, la cancellazione dei dati applicativi è avviata automaticamente quando la revoca è confermata dal server. Un job riprendibile elimina le raccolte operative e la chiave cloud solo dopo aver verificato che non rimangano dati non riconosciuti; le copie locali vengono eliminate dopo prova server del completamento. L'intero account di accesso può essere eliminato con un'azione separata.
            </p>
            <p>
              La prova tecnica minima del consenso, della revoca e della cancellazione è mantenuta separatamente dai dati fitness per sicurezza e responsabilizzazione, con criteri di conservazione da validare. La ricevuta completa del job è programmata per essere ritirata dopo 30 giorni, quando la prova dell'epoca di cancellazione è sufficiente; il termine tecnico non implica l'eliminazione immediata di ogni backup dei fornitori.
            </p>
            <p>
              I file JSON e CSV esportati non sono cifrati e rimangono sotto il controllo di chi li scarica. Backup, eventuali copie di ripristino e log dei fornitori possono avere tempi e limiti separati che devono essere verificati. Nessuna vecchia copia può essere usata per ripubblicare automaticamente un archivio eliminato.
            </p>
            <p style={{ marginTop: '8px', color: 'var(--warning-color)' }}>
              <strong>Attenzione:</strong> TheLogBook sincronizza i dati supportati quando connessione e autorizzazioni lo consentono; dati solo locali o mai sincronizzati potrebbero non essere recuperabili. L'esportazione è facoltativa prima della revoca, ma dopo l'avvio della cancellazione non è garantita la disponibilità dei vecchi dati per il download.
            </p>
          </Section>

          <Section title="Fornitori e trasferimento dei dati">
            <p>I servizi cloud dell'app si appoggiano principalmente ai seguenti fornitori:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Google / Firebase</strong> — Authentication, Firestore, Firebase Hosting e App Check/reCAPTCHA Enterprise. Firebase Authentication elabora i dati di accesso negli Stati Uniti; gli indirizzi IP registrati per l'autenticazione sono conservati per alcune settimane. Dopo la cancellazione di un account, Google indica un termine massimo di 180 giorni per rimuovere le altre informazioni di autenticazione dai sistemi attivi e di backup. Nessun SDK Google Analytics è integrato nel client corrente.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Vercel</strong> — sole funzioni server trusted e manutenzione giornaliera; il frontend/PWA è servito da Firebase Hosting.</li>
            </ul>
            <p>
              I fornitori possono trattare alcuni dati tecnici o personali anche al di fuori dello Spazio economico europeo. Per conoscere ulteriori dettagli sulle destinazioni dei trasferimenti e sulle garanzie adottate, puoi scrivere al recapito privacy indicato in questa informativa.
            </p>
          </Section>

          <Section title="I tuoi diritti (GDPR)">
            <p>Nei limiti e alle condizioni previste dalla normativa applicabile, puoi esercitare i diritti riconosciuti dal GDPR, inclusi:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Accesso e portabilità</strong>: usare backup JSON/esportazione CSV e richiedere le informazioni applicabili al trattamento.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Rettifica</strong>: correggere i dati modificabili tramite l'app.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Cancellazione</strong>: la revoca confermata avvia automaticamente la cancellazione dei dati applicativi senza eliminare l'account di accesso. Puoi inoltre eliminare separatamente l'intero account. Per eventuali dati residui, backup e log tecnici rivolgiti al contatto privacy.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Revoca del consenso</strong>: da Impostazioni → Privacy, con esportazione facoltativa prima della conferma, sospensione delle funzioni fitness e cancellazione automatica dei dati applicativi. L'account resta attivo; un nuovo consenso potrà creare un archivio vuoto dopo la cancellazione.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Limitazione/opposizione</strong>: quando applicabile rispetto alla specifica base giuridica e al trattamento interessato.</li>
            </ul>
            <p>
              Per richieste che non possono essere gestite direttamente dall'app utilizza il contatto privacy <a href="mailto:thelogbook.privacy@gmail.com">thelogbook.privacy@gmail.com</a>. Hai inoltre il diritto di proporre reclamo al Garante per la protezione dei dati personali.
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