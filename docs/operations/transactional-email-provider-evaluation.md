# TheLogBook — scelta del servizio email transazionale (CF-00 B2 / CF-03)

**Stato:** verifica in corso, 13 novembre 2026. **Decisione del product owner:** adottare **Mailjet Free** come nuovo candidato per TheLogBook e **dismettere Brevo** dopo che il sostituto sarà stato verificato. È presente un trasporto Mailjet isolato con test sintetici, non collegato ad Auth e senza invii reali; nessuna operazione su DNS, Auth, Cloudflare o account Brevo autorizza a presumere un cutover compiuto. **Rischio: SENSITIVE**, perché le email di verifica/reset sono parte del boundary Auth (CRITICAL all'integrazione).

## Requisiti di prodotto e gate

- Invii transazionali a indirizzi arbitrari **senza pixel di apertura**, monitoraggio delle aperture, riscrittura degli URL e tracking dei clic. Gli eventuali link di verifica/reset con token devono raggiungere solo l'origine applicativa prevista; i sistemi antivirus dei destinatari non devono consumare i token prima dell'utente.
- Sender istituzionale `TheLogBook <no-reply@notify.thelogbook.me>` dopo autenticazione Mailjet e verifiche reali; DNS, SPF, DKIM, DMARC e posta IONOS non vanno cambiati alla cieca. Per un primo collaudo indipendente valutare un sottodominio di prova differente; non modificare il dominio Brevo esistente fino al GO.
- API HTTPS chiamata **solo dal backend trusted** tramite secret isolato, mai dal client, GitHub o documentazione. Nessun dato salute nelle email. Rispondere ai timeout, 429, 401, 5xx, invii ambigui, quote e abuse senza ACK inventati. L'accettazione API non equivale a consegna.
- **Mailjet Free**: documentazione del 2026 indica **6.000 email/mese, massimo 200/giorno e 1.000 contatti conservati**; include API/SMTP/webhook senza carta di credito. Oltre limite giornaliero l'invio può essere messo in coda, incompatibile con reset scaduti: imporre limiti applicativi e fallire in sicurezza, non acquistare upgrade.
- **Tracking Mailjet**: la guida ufficiale documenta `Account > Tracking > Open tracking = Disabled` (**nessun pixel aggiunto**) e `Click tracking = Disabled` (**nessuna riscrittura dei link**). In API di invio, imporre per singolo messaggio `TrackOpens:"disabled"` e `TrackClicks:"disabled"`; non usare `Anonymous`, che raccoglie aperture aggregate. La modifica account-wide può richiedere fino a **10 minuti** per propagarsi: attendere prima del test. **Queste sono proprietà dichiarate dalla documentazione, NON ancora verificate sulla MIME ricevuta**.
- Prima del GO verificare DPA/subprocessor, retention del contenuto e dei log, localizzazione reale (Mailjet dichiara data center UE, non dimostra da sola assenza di trasferimenti), gestione cancellazione, bounce/suppression, deliverability Gmail/Proton, callback e piano Free su ambiente isolato. Nessuna modifica di billing o Production.

## Esito definitivo della sperimentazione Brevo Free — NON ADOTTARE

| Prova del 13/11/2026 | Evidenza | Esito |
|---|---|---|
| Autenticazione e DNS | `notify.thelogbook.me` e sender verificati in Brevo; CNAME DKIM, TXT code e DMARC `p=none` pubblicati su Cloudflare. SPF/DKIM/DMARC PASS e TLS 1.3 nelle intestazioni Gmail/Proton ricevute | **PASS** per test |
| Invio modello e consegna | Eventi `Consegnata` e conferma ricezione Gmail e Proton (primi test Gmail arrivati in ritardo non diagnosticato) | **PASS** per test |
| API solo testo | Script PowerShell su PC del proprietario, un'unica POST Brevo `/v3/smtp/email` con solo `textContent` e `contactPixelTrackingConsent:false`: **HTTP 201**, una email ricevuta rapidamente in Gmail | **PASS** accettazione API + ricezione; nessuna integrazione Worker |
| MIME originale Gmail | Anche con `textContent`, Brevo converte la mail in `Content-Type:text/html` e inserisce **due tag `<img>` invisibili** (varianti Outlook/altro client) che puntano allo **stesso URL** di tracking `/tr/op/` | **FAIL: pixel presente** |
| Tracking aperture | Il proprietario riferisce inizialmente nessun evento; **nuovo screenshot smentisce**: `Inviata` e `Consegnata` **15:58**, `Prima apertura` **16:08**, `Aperta` **16:08** e **16:09**; i tre eventi di apertura mostrano destinatario `Anonimizzato` | **FAIL: aperture ancora registrate**, anonimizzazione non è rimozione |
| Piano gratuito | Changelog Brevo 29/10/2026: `removeTrackingPixel:true` realmente efficace **solo Enterprise**, ignorato su Free; gestione consenso del contatto non elimina pixel | **NO-GO per requisito zero pixel**, nessun upgrade |

Non duplicare nel repository indirizzi email personali, URL `/tr/op/` completi, header, ID messaggio, credenziali o link di disiscrizione individualizzati. Le evidenze qui sono sufficienti; non servono altri invii Brevo invariati.

## Sequenza di adozione Mailjet e ritiro Brevo

1. **Account Mailjet Free**: creato dal proprietario nella console, senza carta di credito né upgrade. Non creare ancora chiavi API per il client. Prima delle prove, controllare `Account > Tracking`: aperture e clic **Disabled**; confermare persistenza e attesa di 10 minuti.
2. **Dominio di prova separato e DNS**: verificare disponibilità e impostazioni richieste nel pannello Mailjet, poi modificare Cloudflare DNS solo sulla risorsa verificata e con approvazione specifica; mantenere DNS di `notify.thelogbook.me` e MX/SPF/DMARC IONOS finché non si vede il nuovo servizio funzionante. Se si prova direttamente `notify`, confrontare tutti i record DKIM/SPF e preservare gli altri usi prima di ogni modifica.
3. **Test indipendente della posta**: API REST con credenziale temporanea segregata, una email sintetica senza token o dati salute, a un indirizzo personale di prova autorizzato. Controllare accettazione HTTP, **consegna**, headers SPF/DKIM/DMARC/TLS, MIME originale **senza `<img>` e URL di tracking**, apertura ripetuta senza eventi nei log, e link sintetico non riscritto. Nessuna affermazione «zero pixel» senza leggere il MIME.
4. **Integrazione con Auth Workers (CF-03)**: `cloudflare/api/mailjet-auth-email.mjs` prepara un solo messaggio testo, Basic Auth server-only e tracking `disabled` per messaggio. Le regressioni in `tests/cloudflare/mailjet-auth-email.node.mjs` verificano forma delle richieste e fallimenti con fetch simulato. Prima dell'uso reale mancano secret provider, sender validato, impostazioni account, limite antiabuso/quote, token verifica/reset monouso, trattamento degli esiti ambigui tramite job durevoli senza doppio invio e collaudo consegna/MIME. Nessun endpoint pubblico finché non sono validati i gate Auth.
5. **Ritiro Brevo** dopo prova Mailjet e inventario: revocare **solo** le chiavi di test Brevo senza altri utilizzatori; rimuovere i record Brevo obsoleti se non più utilizzati, preservando MX/SPF/DMARC IONOS; controllare i log/retention; **eliminare l'account Brevo solo con conferma esplicita dell'operazione irreversibile** e dopo aver attestato che nessuna funzione lo usa. Nessuna cancellazione eseguita in questo task.
6. Annotare risultati, data, provider attivo, dipendenze, GO/NO-GO in [registro servizi](external-services-register.md), [CF-00 #1054](https://github.com/gernotfound/logbook/issues/1054) e [CF-03 #1057](https://github.com/gernotfound/logbook/issues/1057). PR documentale distinta dal cutover; niente deploy.

## Fonti ufficiali

- [Mailjet prezzi Free](https://www.mailjet.com/pricing/) e [limiti piano Free, aggiornamento 21/10/2026](https://documentation.mailjet.com/hc/en-us/articles/19154256993051-Understanding-Mailjet-Free-Plan-Limits)
- [Mailjet pixel e consenso: Disabled non aggiunge pixel / non riscrive link](https://documentation.mailjet.com/hc/en-us/articles/51109335532571-Email-Tracking-Pixels-and-Consent-CNIL-and-Garante-Guidance)
- [Mailjet SPF/DKIM](https://documentation.mailjet.com/hc/it/articles/360049641733-Autenticare-i-domini-con-SPF-e-DKIM-una-guida-completa)
- [Brevo changelog rimozione pixel Enterprise](https://developers.brevo.com/changelog?rl_entry=e5d47c52f963)
