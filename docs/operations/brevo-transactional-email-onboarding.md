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
| Scelta metodo DNS | Screenshot 13/11: wizard alla fase «Configura metodo» con **Record DNS individuali** o **Configurazione gestita da Brevo** (NS) | **Scelta individuale raccomandata**, non ancora confermata effettuata dal proprietario |
| Wizard Brevo, fase «Record» | Screenshot 13/11: Brevo richiede inizialmente **TXT** con nome relativo `notify` e valore di verifica `brevo-code:…` per `notify.thelogbook.me`; la schermata avverte che il record non corrisponde ancora | **Istruzioni fornite per l'inserimento manuale**; valore completo non copiato nella documentazione pubblica e salvataggio non verificato |
| Conflitti DNS Cloudflare, lettura prima della scrittura | Cloudflare API GET della zona `thelogbook.me` attiva: 11 record; **nessun** record con nome `notify.thelogbook.me` né sotto `*.notify.thelogbook.me` al controllo del 13/11 | **Assenza di conflitto sul nome del primo TXT al momento della lettura**, non prova di un inserimento successivo |
| Configurazione DNS | Screenshot owner e Cloudflare GET 13/11: 12 record zona; TXT `notify.thelogbook.me` presente, valore riconosciuto come `brevo-code:…` (con virgolette di rappresentazione DNS); MX IONOS e DMARC dell'apex conservati | **TXT creato dal proprietario e verificato su Cloudflare; autenticazione Brevo non ancora validata** |
| DKIM 1 | Brevo chiede CNAME `brevo1._domainkey.notify` → `b1.notify-thelogbook-me.dkim.brevo.com`; Cloudflare GET non mostra il nome | **Da aggiungere manualmente; DNS only, TTL Auto** |
| DKIM 2 | Brevo chiede CNAME `brevo2._domainkey.notify` → `b2.notify-thelogbook-me.dkim.brevo.com`; Cloudflare GET non mostra il nome | **Da aggiungere manualmente; DNS only, TTL Auto** |
| DMARC sottodominio | Brevo chiede TXT `_dmarc.notify`; il valore appare troncato nello screenshot, quindi va copiato integralmente dalla UI. Cloudflare GET non mostra il nome; `_dmarc.thelogbook.me` è un CNAME IONOS separato | **Da aggiungere manualmente; senza alterare DMARC apex** |
| Stato email transazionali/API | Nessuna API key, nessuna chiamata autenticata a Brevo, nessun test inbox mostrato | **NON VALIDATO** |
| Impatto runtime | Nessuna modifica a Worker, Firebase/Vercel, Auth, D1, dominio Production | **Nessuna integrazione** |

L'immagine della dashboard è una prova fornita dal proprietario, **non** un read-back via API del provider. Il solo accesso al menu SMTP non prova che l'account possa inviare email.

## Procedura residua e gate

1. Proseguire senza sottodominio personalizzato per i link (schermata precedente completata secondo screenshot fase 3).
2. Alla fase «Configura metodo», preferire **Record DNS individuali** e poi «Aggiunta manuale» nella sezione successiva; non scegliere NS gestiti da Brevo né connessione automatica con privilegi di scrittura DNS Cloudflare. La scelta individuale conserva il controllo degli esatti record in Cloudflare e non delega il sottodominio. **Questa è una raccomandazione, non una configurazione già effettuata.**
3. Prima voce visibile nella fase «Record»: TXT host `notify` (`notify.thelogbook.me`), valore completo da copiare con il pulsante della UI Brevo e TTL automatico su Cloudflare. **Non trascrivere il valore da uno screenshot troncato**, non duplicare il suffisso del nome e non memorizzare il token nel repository pubblico. È stata fornita soltanto la guida all'inserimento manuale: **nessuna scrittura effettuata dal connettore**; attendere conferma del proprietario e read-back.
4. Stato verificato su Cloudflare 13/11: TXT Brevo già inserito dall'owner, 12 record in zona e nessun record DKIM1/DKIM2/DMARC sul sottodominio. Dalla UI Brevo del proprietario sono richiesti: CNAME `brevo1._domainkey.notify` → `b1.notify-thelogbook-me.dkim.brevo.com`; CNAME `brevo2._domainkey.notify` → `b2.notify-thelogbook-me.dkim.brevo.com`; TXT `_dmarc.notify` con contenuto completo da copiare dal portale (non recuperabile dallo screenshot). Sui due CNAME impostare `DNS only` e TTL `Auto`; per DMARC TTL `Auto`. Non usare proxy. Controllare CNAME flattening se DKIM non viene rilevato da Brevo. Salvare singolarmente e confermare con read-back; poi premere `Verifica record`/`Autentica dominio` in Brevo.
5. L'inserimento DNS è svolto dal proprietario via UI; l'assistente resta in sola lettura sul provider. Verificare SPF/DKIM/DMARC e stato autenticazione Brevo con read-back. Non considerare completamento una sola visualizzazione di record in Cloudflare. Non intervenire su MX/SPF/DKIM/DMARC dell'apex IONOS.
6. Verificare se l'account Free è realmente abilitato per email transazionali e quali limiti di quota e approvazione si applicano.
7. Collaudare invio tramite HTTPS con email di test autorizzata, mittente verificato, secret escluso da repository/chat, messaggi privi di dati salute. Distinguere 201/receipt, delivery, bounce, delay, blocchi provider, quota e reset.
8. Prima di procedere con Auth: documentare DPA/subprocessor, durata log transazionali e anteprime corpo, disattivazione del tracking non necessario, protezioni antiabuso, rate limit, token verifica/reset monouso/scadenti.

## Fonti da rileggere al punto di integrazione

- [Brevo API: Send a transactional email](https://developers.brevo.com/reference/sendtransacemail)
- [Brevo: Authentication of your domain](https://help.brevo.com/hc/en-us/articles/115000045390-Authenticate-your-domain-with-Brevo)
- [Brevo: Set up your domain (individual records vs NS, manual vs automatic)](https://help.brevo.com/hc/en-us/articles/35337929909778-Set-up-your-domain-in-Brevo)
- [Brevo: Transactional email logs retention](https://help.brevo.com/hc/en-us/articles/4415743225746-Configure-a-custom-retention-period-for-your-transactional-logs-and-email-previews)

**Regola di aggiornamento:** registrare qui ogni successivo passo realmente osservato con data e limite della prova; riportare gli esiti conclusivi nelle issue CF-00/CF-03 e nel registro servizi esterni. Non promuovere a `ACTIVE` prima di un runtime integrato e verificato.
