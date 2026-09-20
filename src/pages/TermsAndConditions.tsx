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
            <h2 style={{margin: 0,color: 'var(--text-main)'}}>
              Termini e condizioni
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Aggiornati al 20 settembre 2026
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
          fontSize: '0.95rem',
        }}>
          <Section title="1. Accettazione dei termini">
            <p>
              Installando, accedendo o utilizzando LogBook ("l'Applicazione"), l'utente accetta di essere vincolato dai presenti Termini e condizioni. Se non si accettano questi termini, non utilizzare l'Applicazione.
            </p>
          </Section>

          <Section title="2. Disclaimer medico (importante)">
            <div style={{ padding: '16px', backgroundColor: 'rgba(255, 77, 109, 0.1)', border: '1px solid var(--danger-color)', borderRadius: '8px', color: 'var(--text-main)' }}>
              <strong>LogBook non fornisce consulenza medica.</strong>
              <p style={{ marginTop: '8px', marginBottom: 0 }}>
                L'Applicazione è progettata unicamente per tracciare e monitorare l'allenamento fisico e l'alimentazione a scopo informativo e personale. Nessuna informazione fornita dall'Applicazione costituisce parere medico, diagnosi o trattamento.
                Prima di intraprendere qualsiasi nuovo programma di allenamento o dieta, si consiglia di consultare un medico o un professionista sanitario qualificato.
              </p>
            </div>
          </Section>

          <Section title="3. Natura amatoriale del software (AS-IS)">
            <p>
              LogBook è un progetto software sviluppato in modo <strong>amatoriale, indipendente e senza scopo di lucro</strong>. L'Applicazione viene fornita "così com'è" (AS-IS) e "come disponibile", senza garanzie di alcun tipo, né espresse né implicite. Non viene garantito un uptime specifico e il software può presentare bug, difetti, vulnerabilità o errori di calcolo.
            </p>
            <p style={{ marginTop: '8px' }}>
              Il titolare si riserva il diritto di modificare, sospendere, interrompere o cessare il funzionamento dell'Applicazione nei limiti consentiti dalla legge. È consigliato utilizzare periodicamente le funzioni di backup/esportazione disponibili per mantenere una copia personale dei dati.
            </p>
          </Section>

          <Section title="4. Limitazione di responsabilità">
            <p>
              L'uso dell'Applicazione avviene sotto la responsabilità dell'utente, nei limiti consentiti dalla legge applicabile. LogBook non garantisce risultati specifici, inclusi perdita di peso o aumento della massa muscolare, e non sostituisce valutazioni mediche o professionali. Le limitazioni previste in questa sezione non escludono responsabilità che non possono essere escluse o limitate per legge.
            </p>
          </Section>

          <Section title="5. Età minima">
            <p>
              L'Applicazione è destinata esclusivamente a persone maggiorenni (18 anni o più). I minori non devono creare un account né utilizzare il servizio.
            </p>
          </Section>

          <Section title="6. Account e sicurezza">
            <p>
              Se decidi di creare un account cloud, sei responsabile di mantenere sicure le credenziali e i metodi di autenticazione associati al tuo account, inclusi eventuali provider esterni. Il titolare può limitare o chiudere un account quando ciò è necessario per sicurezza, prevenzione di abusi, rispetto della legge o violazioni sostanziali di questi Termini.
            </p>
          </Section>

          <Section title="7. Dati dell'utente">
            <p>
              Mantieni i diritti sui contenuti e sui dati che inserisci nell'Applicazione. Le funzioni di backup, esportazione e cancellazione disponibili nell'app sono descritte anche nell'Informativa sulla privacy, che disciplina il trattamento dei dati personali e i relativi tempi di conservazione.
            </p>
          </Section>

          <Section title="8. Legge applicabile">
            <p>
              I presenti Termini sono disciplinati dalla legge applicabile. Restano salve le tutele inderogabili riconosciute all'utente dalla normativa eventualmente applicabile, incluse quelle relative a consumatori e protezione dei dati personali.
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
