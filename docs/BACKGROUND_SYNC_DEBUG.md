# Debug Background Sync

## Verifica che il sync funzioni

1. Apri DevTools > Application > Service Workers
2. Clicca "Update" per forzare reload del SW
3. Apri Console (dentro DevTools > Service Worker)
4. Esegui azione offline (es. salva allenamento)
5. Torna online → attendi 1-2s
6. Verifica log: `[SW] Sync event received: logbook-sync`

## Errori comuni

### "Sync failed: 401 Unauthorized"
- Token scaduto. L'app ritenterà al prossimo avvio appoggiandosi all'SDK nativo Firestore.

### "Sync failed: Network error"
- Rete instabile o errore 50x. Il SW ritenta automaticamente (max 3 volte con exponential backoff).

### "Sync event non ricevuto"
- Browser non supporta Background Sync (es. Safari iOS).
- Fallback: sync al prossimo avvio dell'app.

## Reset manuale

Per cancellare payload pendenti in locale (IndexedDB):
```ts
import { del } from 'idb-keyval';
await del('pending_sync_payload');
await del('pending_sync_token');
await del('sync_failed');
```
