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
              Aggiornata al 5 novembre 2026
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
              Puoi revocare il consenso per i dati relativi alla salute da Impostazioni → Privacy, scegliendo «Revoca il consenso per i dati salute». La revoca non pregiudica la liceità dei trattamenti effettuati prima della sua efficacia e non equivale alla cancellazione automatica dell'account.
            </p>
            <p>
              Dopo la revoca <strong style={{ color: 'var(--text-main)' }}>non puoi utilizzare le funzioni di allenamento, nutrizione, diario o altre funzionalità fitness</strong>. Rimangono disponibili la consultazione di questa informativa e dei termini, gli strumenti per esercitare i diritti applicabili, l'esportazione JSON dei dati, la cancellazione dell'account e la possibilità di prestare un nuovo consenso esplicito. Non è prevista una modalità fitness ridotta.
            </p>
            <p>
              Se usi un account, l'app interrompe subito le modifiche locali dipendenti dal consenso; se manca la connessione, la richiesta resta in attesa sul dispositivo e non viene presentata come revoca già confermata sul server. La conferma cloud avviene tramite un servizio autenticato. Le modifiche offline precedenti non vengono inviate automaticamente dopo un eventuale nuovo consenso: il loro recupero richiede una scelta separata e può presentare conflitti.
            </p>
            <p>
              In modalità ospite la revoca riguarda i dati locali del dispositivo e non richiede un account. Puoi eliminare i dati ospite localmente. Per un account, dopo che il server ha confermato la revoca, puoi richiedere separatamente la cancellazione dei dati applicativi dell'account (inclusi allenamenti, nutrizione, misurazioni, routine e profilo applicativo), mantenendo il tuo account di accesso: servono connessione, verifica dell'identità e due conferme. Dopo il completamento verrai disconnesso. Puoi anche eliminare l'intero account. Per riattivare le funzioni devi prestare una nuova accettazione esplicita dei documenti correnti; nessun consenso viene ricostruito automaticamente da una vecchia copia o da un backup.
            </p>
            <p>
              La revoca sospende l'uso dei dati per le funzioni fitness, ma da sola non elimina gli archivi già presenti. Puoi esportare i tuoi dati e, dopo la conferma della revoca sul server, richiedere la cancellazione dei dati applicativi senza eliminare l'identità di accesso, oppure cancellare l'intero account.
            </p>
          </Section>

          <Section title="Conservazione, backup e cancellazione dei dati">
            <p>
              I dati locali in modalità ospite rimangono sul dispositivo finché non vengono eliminati dall'utente, rimossi dal browser/sistema oppure migrati secondo i flussi previsti dall'app.
            </p>
            <p>
              I dati applicativi cloud associati all'account sono conservati mentre l'account è attivo e per le funzioni richieste. Dopo la revoca del consenso l'accesso fitness è sospeso, ma i dati già salvati non vengono cancellati automaticamente. Puoi utilizzare gli strumenti autenticati per esportarli o chiederne la cancellazione. TheLogBook offre backup JSON per esportare i dati disponibili e file CSV per le informazioni supportate; i file scaricati sono gestiti da te.
            </p>
            <p>
              La funzione <strong style={{ color: 'var(--text-main)' }}>Elimina account</strong> avvia un workflow server-side che rimuove le raccolte private previste, i dati applicativi cloud e infine l'account Firebase Authentication. Il dispositivo conserva la propria copia locale finché non ha prova che il workflow cloud sia completato, per evitare cancellazioni locali premature in caso di rete instabile.
            </p>
            <p>
              Dopo la cancellazione dell'account resta temporaneamente una ricevuta tecnica priva dei dati fitness, necessaria per verificare il completamento dell'operazione anche sui dispositivi che erano offline. La sua eliminazione è programmata dopo 30 giorni, con il successivo ciclo di manutenzione. Se scegli invece la cancellazione dei soli dati applicativi, rimangono l'account e le informazioni tecniche necessarie a registrare la revoca e impedire che vecchie copie dei dati tornino online.
            </p>
            <p style={{ marginTop: '8px', color: 'var(--warning-color)' }}>
              <strong>Attenzione:</strong> i dati vengono salvati automaticamente sul dispositivo e, con un account, quelli supportati sono sincronizzati con il cloud quando connessione e autorizzazioni lo consentono. Solo i dati già sincronizzati possono essere recuperati dal cloud se l'archivio locale viene perso completamente; i dati ospite e le modifiche ancora offline potrebbero non essere recuperabili. Il backup JSON e l'esportazione CSV sono facoltativi, non necessari periodicamente per il normale utilizzo, e generano file non cifrati da conservare in modo protetto. Il servizio non garantisce backup gestiti di livello enterprise.
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
              <li><strong style={{ color: 'var(--text-main)' }}>Cancellazione</strong>: eliminare l'intero account oppure, dopo revoca confermata e con un account autenticato, usare «Elimina definitivamente i miei dati» per cancellare i dati applicativi (inclusi profilo e misurazioni), mantenendo l'identità Firebase Authentication ma disconnettendo il dispositivo. Per eventuali dati residui, backup e log tecnici rivolgiti al contatto privacy.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Revoca del consenso</strong>: da Impostazioni → Privacy, con sospensione completa delle funzioni fitness; la revoca non pregiudica la liceità dei trattamenti precedenti. Puoi comunque esportare i dati, richiederne la cancellazione e, se lo desideri, prestare un nuovo consenso esplicito.</li>
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