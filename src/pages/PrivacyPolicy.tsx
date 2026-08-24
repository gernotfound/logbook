import React from 'react';
import { X } from 'lucide-react';

export const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div style={{
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
            <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-main)' }}>
              Informativa sulla privacy
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Aggiornata al 22 agosto 2026
            </p>
          </div>
          <button
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
          fontSize: '0.9rem',
        }}>
          <Section title="Titolare del trattamento">
            <p>
              Il titolare del trattamento è il developer indipendente dell'applicazione <strong style={{ color: 'var(--text-main)' }}>LogBook PWA</strong>.
              Per qualsiasi comunicazione relativa alla privacy o all'esercizio dei tuoi diritti, puoi contattarci all'indirizzo email indicato nella pagina delle impostazioni dell'app.
            </p>
            <p>
              Il trattamento avviene nel rispetto del Regolamento Generale sulla Protezione dei Dati dell'Unione Europea (GDPR, Regolamento UE 2016/679) e del D.Lgs. 196/2003 e successive modificazioni.
            </p>
          </Section>

          <Section title="Che cos'è LogBook">
            <p>
              LogBook è un'applicazione web progressiva (PWA) gratuita per il tracciamento degli allenamenti e della nutrizione, progettata con un'architettura <em>offline-first</em>: i tuoi dati risiedono in primo luogo sul tuo dispositivo e vengono sincronizzati sul cloud solo se scegli di creare un account.
            </p>
          </Section>

          <Section title="Dati raccolti e finalità">
            <h3 style={h3Style}>Modalità ospite (senza account)</h3>
            <p>
              In questa modalità <strong style={{ color: 'var(--text-main)' }}>nessun dato personale viene trasmesso a server remoti</strong>. Tutte le informazioni inserite (allenamenti, misurazioni, piani alimentari) sono memorizzate esclusivamente sul dispositivo tramite IndexedDB e localStorage.
              L'applicazione genera unicamente un identificativo di sessione locale, che non viene mai trasmesso all'esterno.
            </p>

            <h3 style={h3Style}>Modalità cloud (con account Google)</h3>
            <p>
              Se scegli di accedere con Google, i dati vengono sincronizzati su Firebase Firestore di Google LLC. Nello specifico vengono trattati:
            </p>
            <ul style={ulStyle}>
              <li>L'indirizzo email e il nome associati all'account Google, ai soli fini di autenticazione.</li>
              <li>I dati di allenamento inseriti (esercizi, serie, carichi, misurazioni corporee, diari alimentari).</li>
              <li>Le preferenze e le impostazioni dell'applicazione.</li>
            </ul>
            <p>
              Questi dati sono memorizzati nella tua area privata su Firestore e non sono accessibili ad altri utenti né al titolare in forma leggibile.
            </p>

            <h3 style={h3Style}>Telemetria tecnica anonima</h3>
            <p>
              L'app raccoglie in modo anonimo alcune metriche tecniche per rilevare errori e migliorare la stabilità:
            </p>
            <ul style={ulStyle}>
              <li>Tipo e messaggio degli errori JavaScript (stack trace troncato a 1000 caratteri, privo di dati personali).</li>
              <li>Eventi del ciclo di vita della PWA (installazione, utilizzo offline, connettività).</li>
              <li>Piattaforma e modalità di visualizzazione (standalone/browser), senza raccolta dell'indirizzo IP o dello user agent completo.</li>
            </ul>
            <p>
              La telemetria non contiene mai: indirizzi IP, email, nomi, dati di allenamento, misure corporee o note testuali inserite dall'utente.
            </p>
          </Section>

          <Section title="Base giuridica del trattamento">
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Esecuzione del contratto</strong> (art. 6, par. 1, lett. b GDPR): per fornire le funzionalità dell'app agli utenti con account.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Legittimo interesse</strong> (art. 6, par. 1, lett. f GDPR): per la telemetria tecnica anonima finalizzata al miglioramento della stabilità e della sicurezza dell'applicazione.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso</strong> (art. 6, par. 1, lett. a GDPR): per la raccolta di statistiche di utilizzo anonime tramite Vercel Analytics, disattivabile in qualsiasi momento dalle Impostazioni.</li>
            </ul>
          </Section>

          <Section title="Statistiche di utilizzo (Analytics)">
            <p>
              Le statistiche di utilizzo anonime tramite <strong style={{ color: 'var(--text-main)' }}>Vercel Analytics</strong> e <strong style={{ color: 'var(--text-main)' }}>Speed Insights</strong> sono abilitate per impostazione predefinita. Nessun dato personale o identificativo viene raccolto a fini di marketing.
            </p>
            <p>
              Puoi disattivare la raccolta in qualsiasi momento tramite il pannello <strong style={{ color: 'var(--text-main)' }}>Impostazioni → Privacy e dati</strong> dell'applicazione.
            </p>
          </Section>

          <Section title="Conservazione e cancellazione dei dati">
            <p>
              I dati locali (modalità ospite) rimangono sul dispositivo finché non vengono eliminati manualmente dall'utente o tramite la funzione <em>"Reimposta app"</em> nelle Impostazioni.
            </p>
            <p>
              I dati cloud (modalità account) vengono conservati finché l'account è attivo. Puoi richiedere la cancellazione completa e immediata di tutti i tuoi dati cloud — incluso il profilo Firebase Auth — tramite la funzione <strong style={{ color: 'var(--text-main)' }}>Elimina account</strong> presente nella sezione <em>Zona pericolosa</em> delle Impostazioni. L'operazione è irreversibile.
            </p>
          </Section>

          <Section title="Trasferimento dei dati e sub-responsabili">
            <p>I dati degli utenti con account cloud vengono trattati dai seguenti fornitori:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Google LLC (Firebase / Firestore)</strong> — autenticazione e database cloud. Dati trattati negli USA con garanzie adeguate (Standard Contractual Clauses).</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Vercel Inc.</strong> — hosting e distribuzione dell'applicazione. Analytics aggregato e anonimo.</li>
            </ul>
            <p>
              Non vengono ceduti dati a terzi per finalità di marketing, profilazione o pubblicità.
            </p>
          </Section>

          <Section title="I tuoi diritti (GDPR)">
            <p>In qualità di interessato, hai il diritto di:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Accesso</strong>: ottenere copia dei dati trattati.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Rettifica</strong>: correggere dati inesatti o incompleti.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Cancellazione</strong>: chiedere la rimozione dei tuoi dati ("diritto all'oblio").</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Portabilità</strong>: esportare i tuoi dati in formato CSV tramite la funzione di esportazione nelle Impostazioni.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Opposizione e limitazione</strong>: opporti al trattamento o richiederne la limitazione.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Revoca del consenso</strong>: disattivare in qualsiasi momento le Analytics dalle Impostazioni.</li>
            </ul>
            <p>
              Per esercitare i tuoi diritti, utilizza le funzionalità disponibili direttamente nell'app o contatta il titolare all'indirizzo email indicato nelle Impostazioni. Hai inoltre il diritto di proporre reclamo all'autorità di controllo competente (in Italia: <strong style={{ color: 'var(--text-main)' }}>Garante per la Protezione dei Dati Personali</strong>, <a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)' }}>www.garanteprivacy.it</a>).
            </p>
          </Section>

          <Section title="Sicurezza">
            <p>
              I dati cloud sono protetti da regole di sicurezza Firestore che impediscono a chiunque — incluso il titolare — di accedere ai dati di un altro utente. Il traffico è cifrato in transito (HTTPS/TLS). L'autenticazione avviene tramite Firebase Auth con verifica dell'integrità dell'app (App Check).
            </p>
          </Section>

          <Section title="Modifiche alla presente informativa">
            <p>
              La presente informativa può essere aggiornata per riflettere modifiche legislative o funzionali dell'applicazione. La data di aggiornamento è sempre visibile in cima a questo documento. L'uso continuato dell'app dopo la pubblicazione di modifiche costituisce accettazione della nuova versione.
            </p>
          </Section>

          <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid var(--glass-border)', textAlign: 'center' }}>
            <button className="btn btn-secondary" onClick={onClose}>
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
  fontSize: '0.9rem',
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
    <h3 style={{
      color: 'var(--text-main)',
      fontSize: '1rem',
      fontWeight: 700,
      marginTop: 0,
      marginBottom: '10px',
      paddingBottom: '6px',
      borderBottom: '1px solid var(--glass-border)',
    }}>
      {title}
    </h3>
    {children}
  </div>
);

