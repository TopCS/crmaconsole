# Security Gate — MAXXI CDP demo

Stato: **implementato e coperto da test**. Questo documento descrive il gate
obbligatorio prima di qualsiasi esposizione pubblica.

## Modello di accesso

| Principal | Come si autentica | Cosa può fare |
|---|---|---|
| `operator` | **Keycloak** (OIDC Authorization Code + PKCE) → cookie di sessione firmato (HMAC-SHA256) | UI e API secondo i **ruoli del realm** |
| `service` | `Authorization: Bearer <CRM_A_SERVICE_TOKEN>` | tool agentici: lettura + bozza campagna dry-run |
| `public_ingestion` | write-key pubblica del tracker (per definizione non è identità) | solo eventi anonimi/identificati di tracking |

La console **non contiene password né account**: identità, credenziali e ruoli
vivono nel realm Keycloak `crm-a` (PostgreSQL dedicato). Il browser viene
rediretto alla login Keycloak, personalizzata con il tema `crm-a`; al ritorno la
console verifica firma, `iss`, `aud`, `exp` e `nonce` dell'ID token, poi emette
il proprio cookie di sessione. Un utente senza ruoli CRM-A viene respinto
(`no_role`), non autenticato con permessi vuoti.

Le credenziali di servizio sono **separate** dai segreti dei webhook:
`CRM_A_SERVICE_TOKEN` autentica solo i tool agentici; i webhook verificano il
proprio segreto (`CRM_A_PHONE_WEBHOOK_SECRET`, HMAC Shopify) nel route che li
serve.

### Ruoli e permessi

| Ruolo | Permessi |
|---|---|
| `admin` | tutti, inclusi seed, gestione utenti Keycloak, audit |
| `communication` | lettura pubblico, eleggibilità, creazione/approvazione bozze |
| `membership` | lettura profili, eleggibilità, membership |
| `infopoint` | lettura profili, gestione feedback + **note infopoint** |
| `relations` | solo organizzazioni e relazioni (niente persone/consensi) |

La decisione di revisione identità richiede il permesso `maxxi.people.review`
(solo `admin`); anche “unisci simulato” registra solo una decisione e un audit,
senza modificare persone, link o consensi.

I ruoli sono assegnati in Keycloak (`realm_access.roles`) e interpretati dalla
matrice locale `apps/web/lib/security/rbac.ts`; un ruolo sconosciuto viene
ignorato. Le note dei casi infopoint sono **mascherate** lato server per i ruoli
senza `maxxi.feedback.viewNotes`. Il concessionario `service` è read-only sui
dati personali; l'unica scrittura consentita è la bozza di campagna dry-run.

I ruoli vengono letti al login: una modifica in Keycloak si applica alla
sessione successiva (TTL 12h, allineato a `ssoSessionMaxLifespan`). Per una
revoca immediata disattivare l'utente in Keycloak e ruotare
`CRM_A_SESSION_SECRET` (invalida tutte le sessioni della console).

## Dove vive il controllo

0. **Keycloak** (`deploy/keycloak/`) — unica fonte di identità. Client
   `crm-a-console` (confidential, PKCE S256, redirect registrati) e client
   `crm-a-admin` (service account con soli `view-users`/`query-users`/
   `manage-users`, usato dalla console per `/maxxi/operators`). Il realm è
   importato all'avvio; il tema di login estende `keycloak.v2`.
1. **`apps/web/middleware.ts`** — choke point unico su tutto il surface web.
   Allowlist esplicita (auto-verificanti la propria credenziale): `/login`,
   `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`,
   `/api/events/collect`, `/api/events/identify`,
   `/api/webhooks/*`, `/api/nlpearl/*`, `/api/campaigns/*`, `/api/demo/*`,
   `/api/marketing/brief`, `/api/shopify/admin`, `/api/maxxi/*` (esatta:
   `/api/crm/segments`), asset statici.
   Tutto il resto richiede una sessione valida: le chiamate `/api/*` ricevono
   JSON 401, le pagine vengono redirette a `/login`.
   Le pagine con vincolo di ruolo (es. `/maxxi/operators` → `admin`) vengono
   redirette a `/maxxi` per un utente autenticato ma non autorizzato.
   Se `CRM_A_SESSION_SECRET` manca o è < 16 caratteri, il gate **fallisce chiuso**
   (solo le route pubbliche restano raggiungibili).
2. **`requireOperator()` / `requireService()`** in `apps/web/lib/security/session.ts`
   e **`guardPermission()`** in `apps/web/app/api/maxxi/_guard.ts` — difesa in
   profondità nei handler più esposti (`/api/crm/*`, `/api/memories`,
   `/api/workspace/query|execute`, `/api/maxxi/*`), così il controllo non dipende
   solo dal middleware. `guardPermission` nega con 403 quando il ruolo non ha il
   permesso richiesto.
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
| SEC-11 | RBAC: ruoli, permessi, note infopoint mascherate, service senza approvazioni |
| SEC-12 | ogni endpoint sensibile nega l'anonimo e il Bearer non valido |
| SEC-13 | OIDC: PKCE S256, state/nonce, firma RS256 + iss/aud/exp, ruoli dal realm, no_role respinto |
| SEC-14 | gestione utenti solo via Keycloak Admin API, mai password/hash in console o nel repo |

Comando:

```bash
pnpm --dir apps/web vitest run lib/security app/api/auth app/api/security-gate.test.ts app/api/middleware.test.ts app/api/maxxi/rbac.test.ts
```

Verifica dal vivo (dev server su porta dedicata) con quattro account demo:

| Caso | Atteso |
|---|---|
| anonimo su `/api/maxxi/overview` | 401 |
| login errato su Keycloak | form con errore, nessuna sessione |
| utente Keycloak senza ruolo CRM-A | `/login?error=no_role`, nessuna sessione |
| `communication` su `/api/maxxi/seed` | 403 |
| `communication` sulle note di `P-GIULIA` | `summary: ""` |
| `infopoint` sulle note di `P-GIULIA` | testo presente |
| `communication` su `/maxxi/operators` | 307 → `/maxxi` |
| service Bearer: lettura | 200 |
| service Bearer: approve/seed/operators | 403 |
| Bearer inventato | 401 |
| logout | cookie azzerato + SSO Keycloak terminato |
| creazione utente da `/maxxi/operators` | utente nel realm, audit con username admin |

## Rischi residui (fuori dal perimetro demo)

- Permessi a grana grossa (risorsa.azione): nessuna autorizzazione per singolo
  record. Le policy a livello di dato (Row-Level Security) arrivano con la
  migrazione a PostgreSQL (ADR-103).
- Keycloak gira in modalità `start` dietro zrok per la pubblicazione
  opzionale; l’Admin Console resta su un hostname locale. In produzione servono
  TLS gestito, realm versionato, backup e un perimetro applicativo più stretto
  di un semplice proxy zrok.
- zrok espone gli endpoint OIDC pubblici: credenziali demo e client secret
  vanno sostituiti prima di condividere gli URL.
- Nessuna rotazione/revoca delle sessioni lato server (TTL 12h, cookie firmato).
- Il tracking pubblico (`/api/events/*`) resta aperto per design con write-key
  pubblica: non va trattato come prova di identità o consenso.
- Nessun rate limiting distribuito (solo quello già presente in memoria).
