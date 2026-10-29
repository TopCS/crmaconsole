# Backlog MAXXI

## P1 — MAXXI come workspace nativo CRM-A

**Stato:** backlog, non implementato.  
**Obiettivo:** rendere MAXXI un workspace selezionabile e autorizzato come gli
altri workspace CRM-A, mantenendo le viste specialistiche.

### Perché non è sufficiente il selettore

Oggi MAXXI è una sezione dedicata con DuckDB separato. Aggiungerla al selettore
senza un contesto server-side per richiesta darebbe solo l’illusione
dell’isolamento: chat, file, tool, grafo e API devono essere legati allo stesso
workspace autorizzato.

### Attività

1. **Registro workspace**
   - MAXXI nel modello `discoverWorkspaces` / selezione workspace;
   - metadati (nome, tema, datasource, stato demo);
   - nessuna migrazione distruttiva dei workspace esistenti.
2. **Contesto e autorizzazione**
   - workspace attivo risolto **server-side** per ogni richiesta;
   - associazione Keycloak `utente → workspace → ruoli`;
   - verifica su API, pagine, chat, tool, grafo, file e audit;
   - test di accesso incrociato tra due utenti e due workspace.
3. **Dati**
   - migrazione del dato operativo a PostgreSQL;
   - Row-Level Security con `workspace_id` e ruolo applicativo senza bypass;
   - mantenere provenance, consensi, identità e semantica eventi;
   - DuckDB resta per demo/analytics e come fallback.
4. **Chat e strumenti**
   - chat CRM-A nel contesto MAXXI;
   - allowlist tool per workspace e ruolo;
   - nessun tool di invio/approvazione/seed non autorizzato;
   - audit coerente.
5. **UI**
   - shell CRM-A con workspace MAXXI selezionato;
   - tema MAXXI scoped invariato;
   - viste specialistiche collegate, non duplicate.
6. **Rilascio**
   - migrazione con rollback;
   - isolamento verificato prima dell’esposizione;
   - aggiornamento di `SECURITY_GATE.md` e `DELIVERY_REPORT.md`.

### Criteri di accettazione

- due workspace non condividono dati tramite API, chat, grafo o file;
- un utente senza associazione al workspace MAXXI riceve 403;
- il workspace MAXXI è selezionabile e persistente;
- nessuna regressione visiva o dati sui workspace standard;
- policy RLS attive e testate;
- demo mode resta fail-closed e senza invii esterni.

### Rischi

- stato workspace condiviso e cache di processo;
- tool/chat che leggono dati fuori contesto;
- migrazione DuckDB → PostgreSQL con semantica dei consensi;
- esposizione pubblica prematura.

## P2 — Pubblicazione zrok

**Stato:** implementata come profilo opzionale; vedi `ZROK.md`.

## P3 — Estensioni demo

- query in linguaggio naturale specifica per il grafo MAXXI;
- snapshot storico dell’audience al momento dell’approvazione;
- dettaglio bozza con modifica/versioning;
- più segmenti e builder generico governato.
