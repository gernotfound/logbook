import React from 'react';
import { X } from 'lucide-react';
import { useScrollLock } from '../hooks/useScrollLock';

export const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useScrollLock();
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'var(--bg-color)',
      zIndex: 100000,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: 'max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))',
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
            <h2 style={{margin: 0,color: 'var(--text-main)'}}>
              Informativa sulla privacy
            </h2>
            <p style={{ margin: '4px 0 0',  color: 'var(--text-muted)' }} className="text-sm">
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

        }} className="text-base">
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
              LogBook è un'applicazione web progressiva (PWA) gratuita per il tracciamento degli allenamenti e della nutrizione, progettata con un'architettura <em>offline-first</em>.
            </p>
            <p>
              <strong style={{ color: 'var(--text-main)' }}>Limitazione d'età:</strong> Il servizio è destinato esclusivamente a utenti maggiorenni (18+). Non raccogliamo intenzionalmente dati di minori. Se sei un minore, ti invitiamo a non utilizzare l'app senza la supervisione di un genitore o tutore.
            </p>
          </Section>

          <Section title="Dati raccolti e finalità">
            <h3 style={h3Style}>Modalità ospite (senza account)</h3>
            <p>
              In questa modalità <strong style={{ color: 'var(--text-main)' }}>nessun dato personale viene trasmesso a server remoti</strong>. Tutte le informazioni inserite (allenamenti, misurazioni, piani alimentari) sono memorizzate esclusivamente sul dispositivo tramite IndexedDB e localStorage.
            </p>

            <h3 style={h3Style}>Modalità cloud (con account Google)</h3>
            <p>
              Se scegli di accedere con Google, i dati vengono sincronizzati su Firebase Firestore di Google LLC. Nello specifico vengono trattati:
            </p>
            <ul style={ulStyle}>
              <li>L'indirizzo email e il nome associati all'account Google, ai soli fini di autenticazione.</li>
              <li>I dati di allenamento inseriti (esercizi, serie, carichi, diari alimentari).</li>
              <li><strong style={{ color: 'var(--primary-color)' }}>Dati relativi alla salute (Art. 9 GDPR):</strong> peso, circonferenze corporee, percentuale di massa grassa, sensazioni di fatica e dolori fisici.</li>
            </ul>
            <p>
              Questi dati sono memorizzati nella tua area privata su Firestore. Sebbene le regole di sicurezza impediscano l'accesso ad altri utenti, il titolare del trattamento (in qualità di amministratore del database) ha tecnicamente accesso ai dati, ma si impegna a non visualizzarli, analizzarli o cederli in alcun modo, se non per adempiere ad obblighi di legge.
            </p>

            <h3 style={h3Style}>Telemetria tecnica anonima</h3>
            <p>
              L'app raccoglie in modo anonimo alcune metriche tecniche (tipo di errori JavaScript, senza dati utente) per migliorare la stabilità.
            </p>
          </Section>

          <Section title="Base giuridica del trattamento">
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Esecuzione del contratto</strong> (art. 6, par. 1, lett. b GDPR): per fornire le funzionalità dell'app.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso Esplicito</strong> (art. 9, par. 2, lett. a GDPR): per il trattamento dei dati relativi alla salute (categorie particolari di dati). Il consenso viene richiesto esplicitamente al primo accesso.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Legittimo interesse</strong> (art. 6, par. 1, lett. f GDPR): per la telemetria tecnica per la stabilità dell'applicazione.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Consenso</strong> (art. 6, par. 1, lett. a GDPR): per le statistiche di utilizzo non essenziali (Analytics).</li>
            </ul>
          </Section>

          <Section title="Statistiche di utilizzo (Analytics) e Cookie Tecnici">
            <p>
              L'applicazione utilizza IndexedDB e localStorage per il funzionamento tecnico offline (salvataggio dati di sessione e utente). Questi sono assimilabili a "cookie tecnici" strettamente necessari e non richiedono consenso preventivo, ma sono necessari all'uso dell'app.
            </p>
            <p>
              Le statistiche di utilizzo anonime tramite <strong style={{ color: 'var(--text-main)' }}>Vercel Analytics</strong> e <strong style={{ color: 'var(--text-main)' }}>Speed Insights</strong> sono <strong style={{ color: 'var(--text-main)' }}>disabilitate per impostazione predefinita</strong> (opt-in). Nessun dato personale o identificativo viene raccolto. Puoi abilitarle o disabilitarle dalle Impostazioni dell'app.
            </p>
          </Section>

          <Section title="Conservazione, Backup e Cancellazione dei Dati">
            <p>
              I dati locali (modalità ospite) rimangono sul dispositivo finché non vengono eliminati manualmente.
            </p>
            <p>
              I dati cloud vengono conservati finché l'account è attivo. Puoi richiedere la cancellazione completa e immediata di tutti i tuoi dati cloud — incluso l'account — tramite la funzione <strong style={{ color: 'var(--text-main)' }}>Elimina account</strong> nelle Impostazioni. L'operazione è irreversibile e costituisce revoca del consenso ai sensi dell'Art. 9 GDPR.
            </p>
            <p style={{ marginTop: '8px', color: 'var(--warning-color)' }}>
              <strong>Attenzione:</strong> Trattandosi di un servizio offerto a titolo amatoriale e gratuito, non sono garantiti backup di livello enterprise. L'utente accetta il rischio di potenziale perdita di dati e si impegna a effettuare esportazioni periodiche (formato CSV) tramite l'apposita funzione.
            </p>
          </Section>

          <Section title="Trasferimento dei dati e sub-responsabili">
            <p>I dati degli utenti con account cloud vengono trattati dai seguenti fornitori:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Google LLC (Firebase / Firestore)</strong> — database cloud. Dati trasferiti e trattati nel rispetto dell'EU-US Data Privacy Framework (o SCC).</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Vercel Inc.</strong> — hosting e analytics anonimo (EU-US Data Privacy Framework).</li>
            </ul>
          </Section>

          <Section title="I tuoi diritti (GDPR)">
            <p>In qualità di interessato, hai il diritto di:</p>
            <ul style={ulStyle}>
              <li><strong style={{ color: 'var(--text-main)' }}>Accesso e Portabilità (Art. 20)</strong>: esportare i tuoi dati in formato CSV dalle Impostazioni.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Rettifica</strong>: correggere i dati tramite l'app.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Cancellazione (Oblio - Art. 17)</strong>: chiedere la rimozione dei tuoi dati.</li>
              <li><strong style={{ color: 'var(--text-main)' }}>Revoca del consenso</strong>: eliminando l'account e i dati.</li>
            </ul>
            <p>
              Per esercitare i tuoi diritti, puoi contattare il titolare all'indirizzo email indicato nelle Impostazioni.
            </p>
          </Section>

          <Section title="Modifiche alla presente informativa">
            <p>
              La presente informativa può essere aggiornata. La data di aggiornamento è visibile in cima al documento.
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

