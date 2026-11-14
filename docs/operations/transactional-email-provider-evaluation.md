# TheLogBook — archivio email transazionali dismesse

**Storico, NON operativo — aggiornato il 14/11/2026.** Brevo e Mailjet erano stati valutati per le email del precedente percorso Auth. Il test Brevo aveva mostrato tracking delle aperture; il dominio Mailjet `notify.thelogbook.me` era stato validato per SPF/DKIM sul pannello, senza una prova definitiva del flusso di invio/Auth. La [PR #1077](https://github.com/gernotfound/logbook/pull/1077) è stata chiusa senza merge perché superata dall'adozione di Kinde.

**Dismissione:** sette record DNS esclusivi dell'ex sottodominio email sono stati eliminati su Cloudflare e verificati (18→11, altri 11 invariati, posta IONOS preservata). **Il proprietario conferma di avere eliminato entrambi gli account.** Non è stato effettuato un accesso indipendente alle rispettive console né verificata la retention di dati, backup, metadati, log e fatture. Le informazioni precedenti rimangono consultabili nella cronologia Git e nelle vecchie PR.

**Target corrente:** Kinde gestirà verifica/reset e altri messaggi Auth. Le sue email e la loro privacy, deliverability, quota e sicurezza richiedono ancora test. Non ripristinare i provider dismessi per errore. [Registro servizi](external-services-register.md).
