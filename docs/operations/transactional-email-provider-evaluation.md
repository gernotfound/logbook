# TheLogBook — archivio di valutazione email transazionali

**ARCHIVIATO / NON OPERATIVO — 14/11/2026.** Questa valutazione storica di Brevo e Mailjet è sostituita dalla decisione del product owner di utilizzare **Kinde** per email/password, Google e invio delle email Auth (verifica, OTP e recupero). Non implementare nuove API Mailjet, SMTP, cron o integrazioni nel backend Cloudflare per il login. L'email Kinde resta **da verificare** per deliverability, contenuto MIME, assenza di tracking non richiesto, rate/quote, retention e privacy: non presumerla equivalente a una prova Mailjet.

**Evidenze storiche conservate:** Brevo Free ha mostrato tracking delle aperture nei test effettuati; Mailjet Free è stato selezionato temporaneamente e configurato sul dominio `notify.thelogbook.me` (attestazioni console SPF/DKIM nella [PR #1077](https://github.com/gernotfound/logbook/pull/1077)), ma non è stato validato il percorso reale Mailjet→Auth. Nessuna prova di cancellazione di account Mailjet/Brevo, credenziali o DNS: il loro ritiro fisico richiede inventario provider e autorizzazione specifica. Conservare [registro servizi](external-services-register.md) e [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054) come fonte per il follow-up. Nessuna cancellazione implicita di record SPF/DKIM/DMARC o configurazioni condivise.

## Ritiro DNS verificato — 14/11/2026

**DNS ritirati il 14/11/2026:** Cloudflare ha cancellato e riverificato 7 record Mailjet/Brevo dedicati a `notify.thelogbook.me`; sono rimasti invariati 11 record non pertinenti, compresa la posta IONOS. Gli account Mailjet/Brevo **non risultano cancellati** e il proprietario dovrà chiuderli nelle rispettive console. Attestazione e vincoli nel [registro operativo](external-services-register.md).

**Conferma non disponibile:** non sono stati chiusi gli account Mailjet o Brevo. Le relative procedure sono self-service nelle console provider e richiedono la sessione del proprietario; non segnare `DELETED` prima di prova esplicita. La ripulitura DNS non modifica il dominio email principale IONOS.
