import React from 'react';
import { X } from 'lucide-react';
import { useScrollLock } from '../hooks/useScrollLock';

export const TermsAndConditions: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useScrollLock();
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
              Termini e Condizioni
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Aggiornati al 28 agosto 2026
            </p>
          </div>
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label="Chiudi termini"
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
          <Section title="1. Accettazione dei Termini">
            <p>
              Scaricando, accedendo o utilizzando l'app LogBook ("l'Applicazione"), l'utente accetta di essere vincolato dai presenti Termini e Condizioni. Se non si accettano questi termini, si prega di non utilizzare l'Applicazione.
            </p>
          </Section>

          <Section title="2. Disclaimer Medico (Importante)">
            <div style={{ padding: '16px', backgroundColor: 'rgba(255, 77, 109, 0.1)', border: '1px solid var(--danger-color)', borderRadius: '8px', color: 'var(--text-main)' }}>
              <strong>LogBook non fornisce consulenza medica.</strong>
              <p style={{ marginTop: '8px', marginBottom: 0 }}>
                L'Applicazione è progettata unicamente per tracciare e monitorare l'allenamento fisico e l'alimentazione a scopo informativo e personale. Nessuna informazione fornita dall'Applicazione costituisce parere medico, diagnosi o trattamento.
                Prima di intraprendere qualsiasi nuovo programma di allenamento o dieta, si consiglia vivamente di consultare un medico o un professionista sanitario qualificato.
              </p>
            </div>
          </Section>

          <Section title="3. Natura Amatoriale del Software (AS-IS)">
            <p>
              LogBook è un progetto software sviluppato in modo <strong>puramente amatoriale, indipendente e senza scopo di lucro</strong>. L'Applicazione viene fornita "così com'è" (AS-IS) e "come disponibile", senza garanzie di alcun tipo, né espresse né implicite. Non viene garantito un uptime (continuità del servizio) specifico e il software può presentare bug, difetti, vulnerabilità o errori di calcolo.
            </p>
            <p style={{ marginTop: '8px' }}>
              Il titolare si riserva il diritto insindacabile di modificare, sospendere, interrompere o cessare definitivamente il funzionamento dell'Applicazione in qualsiasi momento e <strong>senza alcun preavviso</strong>. Ti consigliamo vivamente di utilizzare frequentemente la funzione di esportazione dati per avere un backup personale locale delle tue informazioni.
            </p>
          </Section>

          <Section title="4. Limitazione di Responsabilità">
            <p>
              L'uso dell'Applicazione è a tuo esclusivo rischio. Il titolare dell'Applicazione declina esplicitamente ogni responsabilità per infortuni, danni fisici, problemi di salute, perdita di dati (inclusa la cancellazione improvvisa dell'account o dei salvataggi), danni diretti o indiretti derivanti dall'uso, dall'impossibilità di usare o da malfunzionamenti dell'Applicazione. Non si garantiscono risultati specifici (es. perdita di peso, aumento della massa muscolare) derivanti dall'utilizzo dell'app.
            </p>
          </Section>

          <Section title="5. Età Minima">
            <p>
              L'Applicazione è destinata all'uso da parte di persone maggiorenni (18 anni o più). L'utilizzo da parte di minori è consentito solo sotto la supervisione e l'esplicito consenso di un genitore o tutore legale, il quale si assume la responsabilità dell'accettazione di questi Termini.
            </p>
          </Section>

          <Section title="6. Account e Sicurezza">
            <p>
              Se decidi di creare un account (modalità Cloud), sei responsabile di mantenere la riservatezza delle tue credenziali di accesso Google. Il titolare si riserva il diritto di sospendere o chiudere il tuo account in qualsiasi momento se viene rilevato un uso fraudolento, illegale o in violazione di questi Termini.
            </p>
          </Section>

          <Section title="7. Proprietà dei Dati e Contenuti">
            <p>
              Tutti i dati personali, gli allenamenti registrati e le metriche corporee inserite rimangono di tua esclusiva proprietà. Puoi esportarli o cancellarli in qualsiasi momento tramite le funzionalità dell'Applicazione.
            </p>
          </Section>

          <Section title="8. Legge Applicabile e Foro Competente">
            <p>
              I presenti Termini sono regolati e interpretati in conformità con le leggi della Repubblica Italiana. Per qualsiasi controversia derivante da o relativa all'uso dell'Applicazione, sarà competente in via esclusiva il Foro italiano.
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
