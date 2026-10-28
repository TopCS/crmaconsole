# Delivery Report — MAXXI CDP demo

Data: 2026-10-28 · Branch: `feat/maxxi-cdp-demo` · Base: `main` @ `67c71e5de9`

## 1. Esito dei gate

| Gate | Esito | Note |
|---|---|---|
| G0 baseline | ✅ | Revisione registrata; suite baseline eseguita prima delle modifiche |
| G1 security | ✅ | Default-deny, SQL allowlist, outbound kill switch, bind su 127.0.0.1 — test automatici verdi |
| G2 seed | ✅ | Seed idempotente, isolato, dati sintetici, nessun merge su solo nome |
| G3 demo UI | ✅ | 6 viste navigabili (panoramica, profilo 360, fonti, segmenti, campagne, assistente) |
| G4 agent | ✅ | 3 tool: profilo 360, segmento, proposta dry-run; risposta deterministica grounded |
| G5 actions | ✅ | Zero outbound: adapter bloccati lato server in demo mode + audit |
| G6 regression | ⚠️ | Suite web: 2228 pass / 2 fail **preesistenti** (timeout in `composio-execute-direct.test.ts`). Build web OK. Build Docker bloccata da errore di rete preesistente (`npm install -g openclaw`), non dal codice |

## 2. Test realmente eseguiti

| Comando | Esito |
|---|---|
| `pnpm test:cli` | ✅ 254 test (9 file + 3 file) |
| `pnpm --dir apps/web vitest run` | ✅ 2228 pass, 2 fail preesistenti, 5 skip |
| `pnpm --dir apps/web next build` (distDir temporaneo) | ✅ compilazione completa, 6 pagine `/maxxi` + `/login` + middleware |
| `npx tsc --noEmit -p apps/web` | 5 errori, tutti in test preesistenti non toccati (`crm/segments/[id]/members`, `onboarding/skill-template/consume`, `sessions`) |
| `npx oxlint --type-aware <file modificati>` | ✅ 0 errori nuovi (1 preesistente in `phone-outbound.ts`) |
| `docker compose build` | ❌ bloccato su `npm install -g openclaw@2026.9.1` (rete/registry), step preesistente |

Test nuovi aggiunti (tutti verdi):

- `apps/web/lib/security/session.test.ts` (11) — firma, manomissione, scadenza, fail-closed, password.
- `apps/web/lib/security/sql-guard.test.ts` (10) — multi-statement, DDL, commenti, CTE, allowlist relazioni.
- `apps/web/lib/security/demo-mode.test.ts` (5) — kill switch outbound.
- `apps/web/app/api/security-gate.test.ts` (6) — SEC-01/02/03/05 sulle route.
- `apps/web/app/api/middleware.test.ts` (6) — choke point, redirect, allowlist, fail-closed.
- `apps/web/lib/maxxi/seed.test.ts` (13) — determinismo, idempotenza, ID-001/002/003, DATA-002, SEG-001, CON-001/002.
- `apps/web/lib/maxxi/agent.test.ts` (5) — AGT-001/AGT-002, persona, fallback.

Non eseguiti: E2E browser; test su istanza pubblica (per scelta: nessuna esposizione).

### Verifica live (Next dev su porta dedicata, DB demo temporaneo)

| Passo | Esito |
|---|---|
| `GET /` senza sessione | `307` → `/login` |
| `GET /api/maxxi/overview` senza sessione | `401 {"error":"Unauthorized"}` |
| `GET /login` | `200` |
| `POST /api/auth/login` password errata | `401` |
| `POST /api/auth/login` password corretta | `200` + cookie HttpOnly |
| `POST /api/maxxi/seed` | `8` persone, `11` eventi, `6` card, `7` link, `1` candidato in revisione, `0` invii |
| `GET /api/maxxi/overview` | KPI coerenti (8 identificate, 6 con fonti, 1 anonimo, 1 da revisionare) |
| `GET /api/maxxi/segment` | eleggibili `P-ELENA`, `P-MARIA`; finestra `2026-10-28 → 2026-12-12` |
| `POST /api/maxxi/campaigns` + `approve` | bozza `dry_run` per 2 destinatari, `externalCalls: 0`, audit scritto |
| `POST /api/maxxi/ask` (rinnovi) | risposta grounded con conteggi/finestra |
| `POST /api/maxxi/ask` (donazioni) | `"Non ho evidenze sufficienti"` |
| Pagine `/maxxi*` autenticate | `200` e banner demo presente su tutte |

## 3. File modificati / aggiunti

**Sicurezza**
- `apps/web/middleware.ts` *(nuovo)* — default-deny.
- `apps/web/lib/security/session.ts` *(nuovo)* — sessione firmata, `requireOperator`, `requireService`.
- `apps/web/lib/security/sql-guard.ts` *(nuovo)* — allowlist SQL.
- `apps/web/lib/security/demo-mode.ts` *(nuovo)* — kill switch outbound.
- `apps/web/app/api/auth/login|logout` *(nuovo)*, `apps/web/app/login/*` *(nuovo)*.
- `apps/web/app/api/workspace/query/route.ts`, `execute/route.ts` — auth + allowlist.
- `apps/web/app/api/crm/people/route.ts`, `crm/graph/route.ts`, `crm/graph/node/route.ts`, `memories/route.ts` — `requireOperator`.
- `apps/web/lib/ses.ts`, `openclaw-send.ts`, `phone-outbound.ts`, `nlpearl.ts` — guard outbound.
- `docker-compose.yml` — `127.0.0.1:3100:3100`.
- `.env.example` — nuove variabili.

**MAXXI**
- `apps/web/lib/maxxi/{store,fixture,seed,queries,agent}.ts` *(nuovi)*.
- `apps/web/app/api/maxxi/{seed,overview,people,segment,campaigns,ask}/route.ts` *(nuovi)* + `_guard.ts`.
- `apps/web/app/maxxi/{layout,page,ui}.tsx` + `people/`, `sources/`, `segments/`, `campaigns/`, `agent/` *(nuovi)*.
- `extensions/crm-a-maxxi/*` *(nuovo)* + registrazione in `scripts/build-crm-a-plugins.mjs`.
- `scripts/maxxi-demo.sh` *(nuovo)*.
- `docs/maxxi/SECURITY_GATE.md`, `docs/maxxi/DEMO_RUNBOOK.md` *(nuovi)*.

Nessuna migrazione distruttiva: il dataset demo vive in un DuckDB separato, il
workspace CRM esistente non viene toccato.

## 4. Endpoint nuovi/modificati

Nuovi (operator o service):
`POST /api/auth/login`, `POST /api/auth/logout`,
`POST /api/maxxi/seed`, `GET /api/maxxi/overview`, `GET /api/maxxi/people`,
`GET /api/maxxi/segment`, `GET|POST /api/maxxi/campaigns`, `POST /api/maxxi/ask`.

Modificati (ora protetti): `/api/crm/people`, `/api/crm/graph`, `/api/crm/graph/node`,
`/api/memories`, `/api/workspace/query`, `/api/workspace/execute` — e, via
middleware, l'intera superficie web tranne l'allowlist pubblica.

## 5. Dati demo e reset

- Fixture: `docs/fixtures/maxxi_demo_seed.json` (8 persone, 6 card, 11 eventi,
  10 fonti simulate, orologio fisso `2026-10-28T12:00+01:00`).
- Storage: `<stateDir>/maxxi-demo/maxxi.duckdb` (isolato, resettabile).
- Reset: rieseguire il seed (`scripts/maxxi-demo.sh seed` o il bottone in Panoramica).

## 6. Dove sono i mock

| Elemento | Stato |
|---|---|
| Biglietteria (Archeoares XLS) | connettore **simulato**, tracciato inventato |
| myMAXXI, biblioteca, infopoint | import **simulati** |
| Matomo / SproutSocial / sensori capienza | solo aggregati, **nessun dato personale** |
| Mostre in catalogo | voci pubbliche reali; presenze/interessi inventati |
| Email/SMS/telefono | **bloccati** (dry-run) |
| Agente LLM | fallback deterministico locale, nessun provider cloud |

## 7. Gap e rischi residui

1. **Un solo principal operatore** — nessun RBAC per ruolo (Comunicazione,
   Membership, Infopoint). La UI non finge ruoli non applicati.
2. **Nessuna revoca sessione lato server** (TTL 12h) né rotazione chiavi da UI.
3. **Rate limiting** solo in memoria sul tracking pubblico.
4. **Build Docker** non verificabile in questa sessione per un errore di rete
   preesistente su `npm install -g openclaw`; il build Next è verde.
5. **`.next` root-owned** nel sandbox ha richiesto un `distDir` temporaneo per la
   verifica; la config è stata ripristinata.
6. Il manifest chiedeva il mapping sugli oggetti EAV esistenti: ho scelto un
   **DB relazionale isolato** per avere provenance e determinismo senza toccare
   il workspace CRM. Deviazione dichiarata (vedi §8).
7. `Main` non è stato modificato: il lavoro è sul branch `feat/maxxi-cdp-demo`.

## 8. Decision Log (deviazioni motivate)

- **DB demo separato invece di EAV**: `source_system`/`source_record_id`/`observed_at`
  come colonne di prima classe, aggregati deterministici, reset atomico, zero
  rischio di regressione sul workspace CRM (REG-001). La façade `lib/maxxi/queries.ts`
  è il punto di sostituzione futuro (repository boundary).
- **Fallback deterministico come default dell'assistente**: la demo non dipende da
  un provider LLM; le risposte citano ID e finestra temporale e dichiarano
  "non ho evidenze sufficienti" quando i dati mancano.
- **middleware + guard nei handler**: il middleware è il choke point, i guard nei
  handler evitano che un bypass del middleware (invocazione diretta) apra i dati.
- **`excluded_consent` = "sarebbe eleggibile ma il consenso lo blocca"**, così i
  bucket dell'audience non si sovrappongono.

## 9. Task consigliati per lo sprint successivo

1. **API v1 `/api/v1/cdp/*`** con OpenAPI e scope (read/write separati), sopra la
   façade già isolata.
2. **RBAC + audit a livello record** per i tre ruoli museali.
3. **ADR PostgreSQL vs DuckDB** con benchmark su dataset sintetico ~170k record.
4. **Memoria cliente temporale** (facts con `valid_from`/`valid_to`, `supersedes`)
   per iscrizioni myMAXXI, con provenance in UI.
5. **MCP server** con tool read-only separati e human-in-the-loop sulle scritture.
6. **Import reale** (Archeoares/myMAXXI) dopo la conferma dei tracciati.
