# Security Gate — MAXXI CDP demo

Stato: **implementato e coperto da test**. Questo documento descrive il gate
obbligatorio prima di qualsiasi esposizione pubblica.

## Modello di accesso

| Principal | Come si autentica | Cosa può fare |
|---|---|---|
| `operator` | cookie di sessione firmato (HMAC-SHA256), emesso da `POST /api/auth/login` | UI e API della console, inclusi seed demo e bozze campagna |
| `service` | `Authorization: Bearer <CRM_A_SERVICE_TOKEN \| CRM_A_PHONE_WEBHOOK_SECRET>` | tool agentici e webhook; sola lettura + dry-run sul demo |
| `public_ingestion` | write-key pubblica del tracker (per definizione non è identità) | solo eventi anonimi/identificati di tracking |

Nessun altro principal. **Default-deny**: senza un principal valido le route
rispondono `401`.

## Dove vive il controllo

1. **`apps/web/middleware.ts`** — choke point unico su tutto il surface web.
   Allowlist esplicita (auto-verificanti): `/login`, `/api/auth/*`,
   `/api/events/collect`, `/api/events/identify`, `/api/webhooks/*`,
   `/api/nlpearl/webhook/*`, asset statici.
   Tutto il resto richiede cookie valido; le chiamate `/api/*` ricevono JSON 401,
   le pagine vengono redirette a `/login`.
   Se `CRM_A_SESSION_SECRET` manca o è < 16 caratteri, il gate **fallisce chiuso**
   (solo le route pubbliche restano raggiungibili).
2. **`requireOperator()` / `requireService()`** in `apps/web/lib/security/session.ts`
   — difesa in profondità nei handler più esposti (`/api/crm/*`, `/api/memories`,
   `/api/workspace/query|execute`, `/api/maxxi/*`), così il controllo non dipende
   solo dal middleware.
3. **`guardReadOnlySql()`** in `apps/web/lib/security/sql-guard.ts` — allowlist
   positiva: un solo statement, solo `SELECT`/`WITH`, keyword vietate rimosse dopo
   lo stripping dei commenti, ogni `FROM`/`JOIN` deve essere una relazione
   allowlistata o una CTE locale.

## SQL arbitrario

`/api/workspace/query` e `/api/workspace/execute` non sono più primitivi SQL
generici:

- richiedono un principal `operator`;
- accettano un solo statement `SELECT`/`WITH`;
- rifiutano DDL/DML, `ATTACH`, `COPY`, `PRAGMA`, `INSTALL`, transazioni;
- limitano le relazioni a `entries`, `entry_fields`, `fields`, `objects`,
  `relations`, `v_segment`, ... (vedi `ALLOWED_RELATIONS`);
- limite di lunghezza 20 000 caratteri.

Il blocco per regex non è più l'unica difesa.

## Outbound: kill switch

`apps/web/lib/security/demo-mode.ts` espone `isDemoMode()` /
`assertOutboundAllowed()`. Con `CRM_A_DEMO_MODE=1` i seguenti adapter **falliscono
prima di contattare la rete**:

- `sendSesEmail` (email SES),
- `deliverToSession` (canali OpenClaw: Telegram, WhatsApp, ...),
- `postOutbound` (provider telefonico: dial/telegram),
- `nlpearlRequest` per ogni metodo diverso da `GET`, e `createVoicePearl`.

È un controllo server-side: non esiste un percorso UI, tool, worker o cron che
possa aggirarlo. La view Campagne mostra un avviso se `demo mode` risulta spento.

## Esposizione di rete

`docker-compose.yml` pubblica la porta su **`127.0.0.1:3100`** (prima `3100:3100`
su tutte le interfacce). Per una demo in presenza si usa il tunnel/funnel solo con
autenticazione perimetrale e dopo i test qui sotto.

## Test automatici

`apps/web/lib/security/*.test.ts`, `apps/web/app/api/security-gate.test.ts`:

| ID | Verifica |
|---|---|
| SEC-01 | route CRM/graph/memories senza cookie → 401 e nessun payload |
| SEC-02 | token manomesso/scaduto → 401 |
| SEC-03 | SQL senza auth → 401; multi-statement e DDL → 403 |
| SEC-05 | `SELECT ...; DROP ...`, commenti, CTE e relazioni fuori allowlist |
| SEC-07 | `assertOutboundAllowed` blocca ogni adapter in demo mode |

Comando: `pnpm --dir apps/web vitest run lib/security app/api/security-gate.test.ts`

## Rischi residui (fuori dal perimetro demo)

- Un solo principal operatore: nessun RBAC granulare per ruolo.
- Nessuna rotazione/revoca delle sessioni lato server (TTL 12h, cookie firmato).
- Il tracking pubblico (`/api/events/*`) resta aperto per design con write-key
  pubblica: non va trattato come prova di identità o consenso.
- Nessun rate limiting distribuito (solo quello già presente in memoria).
