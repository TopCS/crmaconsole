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

## P2 — Quack anche per i workspace CRM-A

**Stato:** backlog, non implementato.  
**Obiettivo:** estendere ai workspace CRM-A lo stesso modello già attivo per la
demo MAXXI: un processo proprietario del file DuckDB e client che parlano
Quack, invece di aprire il file (e prendere il lock esclusivo) a ogni query.

### Perché

Nei workspace standard ogni query avvia un processo CLI e apre il file in
lettura/scrittura; le richieste concorrenti si contendono il lock e riprovano
con backoff. La demo MAXXI ha mostrato che il costo dominante non è la query ma
l’apertura ripetuta e il bootstrap dello schema.

### Attività

1. **Server Quack per workspace**
   - un sidecar per workspace attivo, oppure un server multi-database con un
     catalogo per workspace;
   - ciclo di vita legato al workspace (start/stop/restart);
   - token per workspace, mai condiviso tra workspace.
2. **Routing**
   - `duckdbQueryAsync` / `duckdbExecOnFileAsync` instradati a Quack quando il
     workspace è servito;
   - fallback diretto solo per test e per workspace non ancora migrati;
   - nessuna apertura diretta del file mentre il server lo possiede.
3. **Schema e migrazioni**
   - bootstrap una volta per processo/server;
   - migrazioni eseguite dal server, non da ogni client;
   - compatibilità con i file esistenti e rollback.
4. **Sicurezza**
   - Quack solo sulla rete interna, senza porte pubbliche;
   - token ruotabili e distinti per workspace;
   - autorizzazione applicativa invariata (RBAC e RLS restano nel livello API).
5. **Osservabilità e prestazioni**
   - metriche per latenza, connessioni e query fallite;
   - benchmark prima/dopo sui workspace reali;
   - test di concorrenza con più richieste e più agenti.

### Criteri di accettazione

- nessun errore `Conflicting lock` nelle operazioni concorrenti;
- latenza delle route workspace confrontata prima/dopo;
- isolamento tra workspace verificato anche via Quack;
- fallback diretto ancora verde nei test;
- rollback documentato.

### Rischi

- un sidecar per workspace moltiplica i processi;
- il server Quack espone l’intera superficie SQL del file: va trattato come
  confine di rete, non come autorizzazione;
- migrazione graduale con workspace eterogenei.

## P3 — Pubblicazione zrok

**Stato:** implementata come profilo opzionale; vedi `ZROK.md` e `PERFORMANCE.md`.

## P4 — Estensioni demo

- query in linguaggio naturale specifica per il grafo MAXXI;
- più segmenti e builder generico governato;
- template email HTML e anteprima cliente;
- esportazione audit e snapshot.
