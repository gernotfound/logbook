import React from 'react';

export const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'var(--bg-color)', zIndex: 100000,
      overflowY: 'auto', padding: '20px', paddingBottom: '80px'
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', position: 'sticky', top: '10px', backgroundColor: 'var(--bg-color)', padding: '10px 0' }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--text-main)' }}>Informativa sulla privacy</h1>
            <button className="btn btn-secondary" onClick={onClose}>
              Chiudi
            </button>
          </div>
          <div 
            style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}
            dangerouslySetInnerHTML={{ __html: "<h1></h1>  <strong></strong> 22 agosto 2026   <strong></strong> LogBook PWA   <strong></strong> Regolamento Generale sulla Protezione dei Dati dell'Unione Europea (GDPR, Regolamento UE 2016/679) e D.Lgs. 196/2003 e s.m.i.  ---  <h2></h2>  <p></p>  <p></p>  ---  <h2></h2>  <p></p> <ul><li></li> <li></li> <li></li>  </ul>Per qualsiasi chiarimento in merito al trattamento dei tuoi dati personali, o per esercitare i diritti riconosciuti dalla normativa comunitaria, puoi contattare il Titolare in qualsiasi momento all'indirizzo email sopra indicato o utilizzare le funzionalità di gestione e cancellazione presenti direttamente all'interno dell'applicazione.  ---  <h2></h2>  <p></p>  <p></p>  <p></p>  ---  <h2></h2>  <p></p>  <h3></h3> <ul><li></li> </ul>  - Indirizzo di posta elettronica (email). <p></p> <p></p> <ul><li></li> </ul>  - Nessun dato anagrafico o identificativo telematico viene trasmesso a server remoti. L'applicazione genera unicamente un identificativo di sessione locale memorizzato sul dispositivo dell'utente.  <h3></h3> <p></p> <ul><li></li> <li></li> <li></li> <li></li>  </ul><h3></h3> <ul><li></li> <li></li> <li></li>  </ul><h3></h3> <ul><li></li> <li></li>  </ul>---  <h2></h2>  <p></p>  ``` ┌─────────────────────────────────────────────────────────────────────────────┐ <p></p> ├───────────────────────────────────┬─────────────────────────────────────────┤ <p></p> ├───────────────────────────────────┼─────────────────────────────────────────┤ <p></p> <p></p> <p></p> ├───────────────────────────────────┼─────────────────────────────────────────┤ <p></p> <p></p> <p></p> <p></p> ├───────────────────────────────────┼─────────────────────────────────────────┤ <p></p> <p></p> <p></p> ├───────────────────────────────────┼─────────────────────────────────────────┤ <p></p> <p></p> <p></p> └───────────────────────────────────┴─────────────────────────────────────────┘ ```  <p></p>  ---  <h2></h2>  <p></p>  <p></p>  <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p>  ---  <h2></h2>  <p></p>  <p></p> |---|---|---| <p></p> <p></p> <p></p> <p></p> <p></p>  ---  <h2></h2>  <p></p>  <p></p> <p></p> <p></p> <p></p> <p></p> <p></p>  <p></p>  ---  <h2></h2>  <p></p>  <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p> <p></p>  ---  <h2></h2>  <p></p>  <ul><li></li> <li></li> <li></li> <li></li> <li></li>  </ul>---  <h2></h2>  <p></p> <p></p> <p></p> <p></p>  ---  <h2></h2>  <p></p>  <p></p> " }}
          />
      </div>
    </div>
  );
};
