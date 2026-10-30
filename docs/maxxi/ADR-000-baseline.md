# ADR-000 — Baseline e modalità demo

**Data:** 2026-10-28 · **Branch:** `feat/maxxi-cdp-demo` · **Base:** `main` @ `67c71e5de9`

## Contesto

CRM-A Console (fork DenchClaw su OpenClaw) è già un CDP con workspace CRM, EAV
DuckDB, eventi, segmenti, campagne, identity merge e runtime agentico. Il
pacchetto `docs/` chiede una **demo verticale MAXXI** senza replatforming e senza
esporre dati senza controllo di accesso.

## Decisione 1 — Branch non distruttivo

`main` non viene toccato. Tutto il lavoro vive su `feat/maxxi-cdp-demo`, che
include `docs/` (documentazione di committenza) e le fixture sintetiche.

## Decisione 2 — Baseline registrata

Prima delle modifiche la suite era: `pnpm test:cli` ✅ e
`pnpm --dir apps/web vitest run` con **2 fallimenti preesistenti**
(`lib/composio-execute-direct.test.ts`, timeout 30s) e 5 test skippati.
Errori `tsc --noEmit` preesistenti: `crm/segments/[id]/members/route.test.ts` (2),
`onboarding/skill-template/consume/route.test.ts` (1),
`sessions/sessions.test.ts` (2).

Questi numeri sono la linea di base: nessun test nuovo intacca il workspace CRM
e nessun fallimento è stato introdotto.

## Decisione 3 — Dataset demo in un database isolato

Il vertical MAXXI usa un DuckDB dedicato (`<stateDir>/maxxi-demo/maxxi.duckdb`)
con schema relazionale, invece di estendere l'EAV del workspace CRM.

Motivi:
- `source_system`/`source_record_id`/`observed_at` sono colonne di prima classe
  (provenance richiesta dal contratto dati);
- aggregati deterministici e idempotenti senza rebuild di viste EAV;
- reset atomico senza toccare altri workspace (REG-001);
- la façade `apps/web/lib/maxxi/queries.ts` è il punto di sostituzione futuro
  (repository boundary verso PostgreSQL o verso l'EAV migrato).

**Conseguenza:** le viste MAXXI sono separate da `/workspace`; non riusano i
componenti CRM generici. È un compromesso esplicito a favore della demo e della
sicurezza.

## Decisione 4 — Un solo principal operatore, autenticazione reale

La demo ha un principal `operator` protetto da password + cookie firmato
(HMAC-SHA256). Non viene simulato un RBAC per ruolo: la UI non presenta permessi
che non esistono.

Motivo: SEC-03 vieta credenziali hardcoded e finti login su endpoint aperti.

## Decisione 5 — Fallback deterministico per l'assistente

Le risposte dell'assistente sono calcolate da query sul dataset, con finestra
temporale e ID di evidenza. Se il provider LLM manca, la demo resta completa.
Il contratto "non inventare" (AGT-002) è più facile da garantire in modo
deterministico che con un prompt.

## Alternative scartate

- **Estendere l'EAV con nuovi oggetti MAXXI**: avrebbe mescolato i dati demo al
  workspace reale e reso il reset pericoloso.
- **Proxy verso i sistemi del museo**: nessun accesso, nessun tracciato reale,
  e i fixture sono inventati per contratto.
- **RBAC finto in UI**: escluso esplicitamente dal PRD.
