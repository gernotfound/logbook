# Brevo — onboarding email transazionali Cloudflare (CF-00 B2)

**Stato: BOZZA OPERATIVA, NON ATTIVATO / NON VALIDATO.** Checkpoint 13/11/2026. Collegato alle issue [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054), [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057) e all'[epic #1053](https://github.com/gernotfound/logbook/issues/1053). Questo documento registra soltanto l'onboarding del servizio email, senza autorizzare l'integrazione Auth, il cambio DNS o il rilascio. Riferimento normativo: `AGENTS.md` e `.agents/rules/external-services.md`.

## Scelta in corso

- **Provider candidato:** Brevo Free, non ancora verificato per l'invio transazionale sull'account TheLogBook. La selezione è condizionata a disponibilità Free, limiti, deliverability e controlli privacy.
- **Integrazione futura:** API HTTPS server-side di Brevo da Cloudflare Worker; API key soltanto nel Secret del Worker, mai nel client, nei commit o nei log. Non attivare la nuova Auth sulla sola base di questa scelta.
- **Dominio mittente previsto:** `notify.thelogbook.me`. Email indicativa `no-reply@notify.thelogbook.me`, **non ancora configurata né verificata**.
- **Sottodominio facoltativo proposto dalla procedura Brevo:** ad esempio `mail.notify.thelogbook.me`. Si riferisce all'hostname dei collegamenti nelle email, **non** al dominio mittente. Il product owner è stato guidato a lasciarlo vuoto: non sono necessari URL personalizzati o tracciamento dei clic per verifica/reset account.
- **Posta esistente:** DNS `thelogbook.me` conserva MX e record correlati a IONOS. Non modificare i record esistenti per impostare il nuovo mittente. L'eventuale aggiunta di record nel sottodominio richiede read-back e autorizzazione specifica prima della scrittura.
- **Nessun dato personale nei test sintetici:** distinguere sempre accettazione API (es. `messageId`) dalla consegna reale e dalla verifica dell'utente; niente successo fittizio e niente retry incontrollati.

## Evidenze distinte

| Voce | Evidenza | Stato |
|---|---|---|
| Registrazione Brevo | Screenshot del product owner: dashboard e sezione email transazionali/SMTP accessibili | **Account creato**, invio reale non provato |
| Inserimento dominio | Screenshot del product owner: procedura Brevo alla fase 2 «Sottodominio personalizzato (opzionale)» per `notify.thelogbook.me` | **Inserito nella procedura**, non autenticato |
| Sottodominio link personalizzati | La UI mostra un campo con suffisso `.notify.thelogbook.me`, dichiarato opzionale | **Non necessario**; indicato di proseguire con campo vuoto |
| Configurazione DNS | Il product owner non ha ancora fornito il successivo set di record da Brevo; nessuna scrittura DNS effettuata in questo task | **Non avviata** |
| Stato email transazionali/API | Nessuna API key, nessuna chiamata autenticata a Brevo, nessun test inbox mostrato | **NON VALIDATO** |
| Impatto runtime | Nessuna modifica a Worker, Firebase/Vercel, Auth, D1, dominio Production | **Nessuna integrazione** |

L'immagine della dashboard è una prova fornita dal proprietario, **non** un read-back via API del provider. Il solo accesso al menu SMTP non prova che l'account possa inviare email.

## Procedura residua e gate

1. Proseguire senza sottodominio personalizzato per i link.
2. Acquisire i record esatti richiesti da Brevo per l'autenticazione di `notify.thelogbook.me`; confrontarli con Cloudflare DNS **in sola lettura** prima di qualsiasi modifica.
3. Solo con autorizzazione pertinente, aggiungere esclusivamente record non conflittuali del sottodominio, verificare SPF/DKIM/DMARC e stato autenticazione con read-back. Non intervenire su MX/SPF/DKIM/DMARC dell'apex IONOS.
4. Verificare se l'account Free è realmente abilitato per email transazionali e quali limiti di quota e approvazione si applicano.
5. Collaudare invio tramite HTTPS con email di test autorizzata, mittente verificato, secret escluso da repository/chat, messaggi privi di dati salute. Distinguere 201/receipt, delivery, bounce, delay, blocchi provider, quota e reset.
6. Prima di procedere con Auth: documentare DPA/subprocessor, durata log transazionali e anteprime corpo, disattivazione del tracking non necessario, protezioni antiabuso, rate limit, token verifica/reset monouso/scadenti.

## Fonti da rileggere al punto di integrazione

- [Brevo API: Send a transactional email](https://developers.brevo.com/reference/sendtransacemail)
- [Brevo: Authentication of your domain](https://help.brevo.com/hc/en-us/articles/115000045390-Authenticate-your-domain-with-Brevo)
- [Brevo: Transactional email logs retention](https://help.brevo.com/hc/en-us/articles/4415743225746-Configure-a-custom-retention-period-for-your-transactional-logs-and-email-previews)

**Regola di aggiornamento:** registrare qui ogni successivo passo realmente osservato con data e limite della prova; riportare gli esiti conclusivi nelle issue CF-00/CF-03 e nel registro servizi esterni. Non promuovere a `ACTIVE` prima di un runtime integrato e verificato.
