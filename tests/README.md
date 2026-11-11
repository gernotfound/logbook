# Organizzazione delle suite di test

**Contratti:** [AGENTS.md](../AGENTS.md) e [Verifica CI](../.agents/rules/ci-verification.md). Il gate completo resta `npm run verify:m8` oppure la CI equivalente sullo SHA esatto; le suite isolate non sono sostituibili dai test jsdom.

## Dove collocare un test

La **responsabilità funzionale** determina la cartella, mentre il **runner** determina l'ambiente e il gate. Evitare una cartella per singolo test o per milestone temporanea.

| Area | Cartella | Responsabilità |
| --- | --- | --- |
| Account | `account/auth/`, `account/guest/`, `account/deletion/` | Accesso, guest, ciclo di vita e cancellazione |
| Analytics | `analytics/` | Calcoli, grafici e worker |
| Catalogo | `catalog/` | Catalogo, risoluzione e paginazione |
| Dominio | `domain/` | Operazioni business e invarianti |
| Firebase | `firebase/` | Configurazione client, App Check e regole di sicurezza |
| Consenso salute | `health/` | Autorizzazioni, revoca, diritti ed erasure |
| Portabilità | `portability/` | Backup, esportazione JSON/CSV e importazione |
| Schema | `schema/` | Validazione, compatibilità e sanitizzazione |
| Persistenza | `storage/` | IndexedDB, vault, bozze e recupero |
| Sincronizzazione | `sync/` | Merge, replica, conflitti e chiavi cloud |
| Integrazione trasversale | `system/` | Scenari che attraversano più aree funzionali |
| Ambiente test | `tooling/` | Isolamento e configurazione degli strumenti E2E |
| Nutrizione | `nutrition/` | Alimenti, pasti, pianificazione e UI |
| PWA | `pwa/` | Registrazione, aggiornamenti e lifecycle |
| Allenamento | `training/` | Cicli, esercizi, sessioni e pianificazione |
| Interfaccia | `ui/` | Navigazione, temi, accessibilità e impostazioni |
| Runner stress | `stress/` | Test adversarial e di carico selezionati per nome |
| Runner specializzati | `isolated/`, `emulator/`, `fuzz/`, `recovery/`, `gc/`, `hardening/` | Mantengono i propri setup e criteri di discovery |

La radice di `tests/` contiene soltanto fixture e setup condivisi: **nessun file `.test.*` o `.spec.*` deve essere collocato direttamente qui**. `test:discovery` verifica anche questo vincolo. I test co-locati in `src/` restano vicini al modulo quando utile. I test browser e le fixture Playwright restano in `e2e/` finché i loro contratti di discovery e di progetto non vengono aggiornati insieme.

## Invarianti degli spostamenti

- Spostare gruppi funzionali, aggiornando **tutti** gli import relativi, i mock e i percorsi citati in script, configurazioni e documentazione.
- Preservare i nomi `challenger_*`, `*adversarial*` e `*stress*` quando determinano il runner stress. Non spostare suite Node nel runner jsdom o viceversa.
- Conservare le fixture condivise (`setup.tsx`, `secureVaultFixture.ts` e altre) in un punto comune, senza duplicarle.
- `test:discovery` deve dimostrare che ogni test è assegnato una sola volta; `test:coverage:critical` deve conservare la selezione critica indipendentemente dalla profondità della cartella.
- Dopo ogni gruppo, verificare lint, TypeScript, test normativi, suite dedicate e CI canonica. Non ridurre asserzioni, coverage o controlli per agevolare il riordino.
