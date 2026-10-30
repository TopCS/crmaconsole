# Piano evolutivo di CRM-A Console: CDP agentica, non CRM tradizionale

**Data baseline:** 2026-10-28. **Target:** `TopCS/crmaconsole`, versione dichiarata 4.2.0 sul ramo main al momento della ricognizione. **Fonte:** analisi statica di README, package e file codice; eseguire nuova discovery prima di modificare il repo.

## 1. Product thesis e confini

- Nome visibile al cliente: **CRM MAXXI / MAXXI Customer Intelligence**.
- Definizione tecnica: **CDP local-first con workspace CRM, identity resolution, event timeline, segmentazione, attivazione governata e runtime agentico OpenClaw**.
- Il CRM e' una delle viste operative della CDP, non la fonte unica della verita'.
- NON fare un clone di OpenClaw CRM, NON sostituire OpenClaw, NON migrare globalmente DuckDB a PostgreSQL in questa tranche, NON lanciare marketing reale.
- Preservare compatibilita' con altri vertical: tutto cio' che riguarda MAXXI deve essere configurabile per singolo workspace, non assunto globalmente.

## 2. Stato effettivamente osservato nel repository

| Area | Evidenza di codice | Interpretazione | Conseguenza |
|---|---|---|---|
| Gateway OpenClaw | README, `package.json`, `Dockerfile` | Profilo dedicato `crm-a`; Gateway 19001; UI Next.js 3100 | Riutilizzare agent runtime, strumenti e canali |
| CRM EAV DuckDB | `apps/web/lib/workspace.ts`, `skills/crm/SKILL.md`, `apps/web/lib/workspace-schema-migrations.ts` | Entita' dinamiche, `entries`, `fields`, `entry_fields` | Estendere per workspace con migration idempotenti |
| CDP events | `apps/web/lib/events.ts`, `/api/events/collect`, `/api/events/identify` | Eventi, visitatori anonimi/identificati, tracking | Riutilizzare con provenance e consenso |
| Identity merge | `apps/web/lib/people-merge.ts` | Merge di persone e rimappatura relazioni | Aggiungere policy conservativa e review |
| Segments | `apps/web/lib/segments.ts` | Filtri attributi + condizioni sugli eventi | Creare segmenti museo senza inventare dati |
| Campaigns | `apps/web/lib/campaigns.ts` | SES queue, pause/resume, bounce/complaint, multicanale | Implementare `preview only` fail-closed nel profilo demo |
| Relazioni | `apps/web/lib/crm-graph.ts` | Proiezione SQL a grafo con profondita' limitata, read-only | NON chiamarlo ancora knowledge graph temporale |
| Strength scoring | `apps/web/lib/strength-score.ts` | Peso interazioni e decadimento nel tempo | Esporre come segnale spiegabile, non come valore oggettivo |
| Contatti | `apps/web/lib/gmail-sync.ts`, `calendar-sync.ts` | Import e aggiornamento in base a servizi terzi | Mock per il museo, senza credenziali esterne |
| Phone | `apps/web/app/api/webhooks/phone/route.ts` | Eventi inbound/completed/message + contesto CRM | Demo infopoint da fixture, non telefonate vere |
| Observability | `TELEMETRY.md` | PostHog opt-out, privacy mode default | Nella demo preferire telemetry disabilitata |

### Differenze da OpenClaw CRM da adottare selettivamente

Riferimento: `https://github.com/giorgosn/openclaw-crm`.
- **Adottare**: API CRM versionate, modellazione del contesto di auth per workspace, API key con rotazione/revoca, distinzione fra tool con lettura e tool di scrittura, documentazione OpenAPI, test E2E riproducibili.
- **Non adottare automaticamente**: cambio immediato del database, sostituzione del runtime OpenClaw, duplicazione delle feature CDP, secondo monorepo applicativo.
- **ADR futuro**: PostgreSQL per multiutenza e transazioni; DuckDB per locale/analytics. Richiede benchmark e piano di migrazione, non un refactor improvvisato.

## 3. Security gate: blocco alla pubblicazione, P0

### 3.1 Endpoint da verificare in via prioritaria

- `apps/web/app/api/crm/people/route.ts` (lettura dati personali)
- `apps/web/app/api/crm/graph/route.ts`, `.../graph/node/route.ts` (relazioni e dettagli)
- `apps/web/app/api/memories/route.ts` (MEMORY.md e percorsi workspace)
- `apps/web/app/api/workspace/query/route.ts` (filtri SQL superficiali)
- `apps/web/app/api/workspace/execute/route.ts` (blocco solo di alcuni prefissi SQL)
- `apps/web/app/api/workspace/*`, `apps/web/app/api/chat/*`, `apps/web/app/api/gateway/*` (inventario completo)
- `apps/web/app/api/events/collect/route.ts` (endpoint pubblico con write key e rate limit in memoria)
- `apps/web/app/api/webhooks/phone/route.ts` (Bearer dedicato, verificare scope e replay)
- `docker-compose.yml` espone `3100:3100`; `Dockerfile` e README contemplano Tailscale Funnel.

Dalla lettura statica le route sopra non dimostrano tutte una policy di auth centralizzata. **Non dichiarare CVE o exploit confermati** senza test; trattare come gap di hardening da chiudere.

### 3.2 Requisiti non negoziabili

SEC-01: percorso default-deny: qualsiasi chiamata a CRM, memoria, workspace, upload, graph e agente restituisce 401/403 senza principal valido, anche con request creata fuori dalla UI.

SEC-02: separazione tra `principal=user`, `principal=service` e `principal=public_ingestion`; `workspaceId` non deve poter essere scelto arbitrariamente da parametri client senza controllo di membership.

SEC-03: autenticazione a sessione o token a scope limitato per UI e API. Per demo locale, creare un gate operatore sicuro, evitando credenziali note hardcoded e falso login front-end.

SEC-04: endpoint SQL generici non utilizzabili via rete pubblica; sostituire con query applicative parametrizzate/allowlist di operazioni. Validare anche multi-statement, commenti, CTE, EXPLAIN, funzioni e varianti. **Non affidarsi a blocco regex di keyword**. Test distruttivi solo su database di fixture.

SEC-05: endpoint ingestion aperti solo come eccezioni esplicite, con token specifici, quota, limite payload, protezione da replay e validazione schema. La write key incorporata nel tracker web e' *pubblica per definizione*: non trattarla come prova di identita' o consenso.

SEC-06: default Docker bind su `127.0.0.1`, niente Funnel pubblico di default. Per l'evento commerciale aprire accesso solo con autenticazione perimetrale robusta + verifica SEC-01-05.

SEC-07: demo sicura sul server: disabilitare tutti gli invii e le chiamate outbound anche per tool, worker, cron, code e API esistenti. No flag client-only. Preferire un adapter provider `dryRun` che produce un log di simulazione.

SEC-08: log e tracce senza PII reali, token o body email; telemetria disabilitata per demo o esplicitamente opt-in. No segreti versionati. Nessun dato di pubblico reale.

SEC-09: audit `who/when/action/target/result/source/approval` anche per la demo, con identita' operatore. Record immutabile/append-only almeno nel contesto della sessione demo.

SEC-10: test di isolamento tra workspace MAXXI e uno workspace non MAXXI; l'agente non deve poter cercare o modificare dati oltre il workspace attivo e autorizzato.

## 4. Evoluzione CDP: P1 e P2

### P1: confini di dominio e API stabile

Mettere una facade applicativa sopra le query al workspace; evitare che nuovi componenti parlino direttamente con EAV/CLI da tutte le parti. Interfaccia minima:

- `getPerson360(personId, principal)`
- `listPersonEvents(personId, cursor, principal)`
- `resolvePerson(candidate, principal) -> exact | candidate | not_found`
- `listSegmentMembers(segmentId, principal, options)`
- `getMembershipStatus(personId, principal)`
- `previewCampaign(segmentId, templateId, principal)`
- `recordActionProposal(...)`, `approveProposal(...)` (senza send esterno in demo)

Proporre REST versionate `/api/v1/cdp/...` solo se compatibili con i pattern del repository; altrimenti esporre facade interna e redigere OpenAPI. Validare schema, paginare, limitare payload e impedire injection. Tutte le funzioni ricevono `principal` esplicito dal server, non dal body.

### P2: memoria cliente (separata da MEMORY.md OpenClaw)

Disegnare il contratto per fatti/eventi con:
- `fact_id`, `subject_id`, `predicate`, `object_value` / `object_ref`
- `source_system`, `source_record_id`, `evidence_ref`, `confidence` (non auto-asserito per dati importati), `observed_at`, `valid_from`, `valid_to`, `recorded_at`, `supersedes`, `status`
- `tenant_id/workspace_id`, `purpose`, `sensitivity`, `retention_class`.

NON sviluppare un nuovo graph engine per la prima demo. Produrre ADR/prototipo solo per 1-2 fatti storicizzati (es. iscrizione myMAXXI valida per periodo), con provenance visibile in UI e query deterministica.

### P3: infrastruttura da pianificare, non implementare nella demo

- Multiutente: autentica RBAC/ABAC e audit a livello di record/campo.
- Migrazione a PostgreSQL transazionale e/o architettura ibrida DuckDB, benchmark su dataset sintetico di dimensione equivalente ai circa 170k record indicati **nel 2024**.
- Esportazione, backup, cancellazione/portabilita', retention, controller/processor GDPR, consenso comunicazioni distinto da liceita' del trattamento dati CRM.
- MCP server esterno con tool read/write separati, scopes e human-in-the-loop su ogni azione di scrittura ad alto rischio.

## 5. Definition of Done per il lavoro tecnico

- SEC-01/SEC-10 coperti da test negativi e di isolamento.
- Nessun invio dal profilo demo sotto qualsiasi percorso (UI, endpoint, tool, worker).
- Migrazioni idempotenti e add-only: stessi dati dopo secondo seed (no duplicazioni).
- Funzionalita' CRM non MAXXI non regressa, test verdi o problemi preesistenti riportati con prove.
- Documentato un ADR per PostgreSQL e per il perimetro MCP, senza introdurli per forza.
- Un `DELIVERY_REPORT.md` con test realmente eseguiti, branch/commit, percorso UI e gap noti.

## 6. Non-goals espliciti

- Migrazione dei dati reali MAXXI, integrazioni API reali con Archeoares o altri fornitori, consenso marketing legale verificato, BI predittiva, email delivery, pagamenti, sostituzione del CRM Aruba, pubblicazione SaaS e multi-tenant completo.
