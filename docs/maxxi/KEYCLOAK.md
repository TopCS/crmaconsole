# Keycloak — identità e accesso

> Stack demo locale. In produzione: TLS, `start` (non `start-dev`), segreti
> fuori dal repo, backup del database Keycloak.

## Cosa c'è nello stack

| Componente | Ruolo | Porta |
|---|---|---|
| `keycloak-db` (PostgreSQL 16) | persistenza del realm Keycloak | interna |
| `keycloak` (Keycloak 26) | login, utenti, ruoli, sessioni SSO | `127.0.0.1:8080` |
| `crm-a-console` (Next.js) | applicazione, RBAC e audit | `127.0.0.1:3100` |

Il CRM resta su DuckDB: Keycloak ha un database **separato**. La migrazione del
dato CRM a PostgreSQL con Row-Level Security è ADR-104.

```bash
docker compose up -d keycloak-db keycloak
# Admin Console: http://localhost:8080  (admin / KEYCLOAK_ADMIN_PASSWORD)
# Realm: crm-a
```

Il realm viene importato all'avvio da `deploy/keycloak/realm/crm-a-realm.json`
(client, ruoli, utenti demo, mapper). Le modifiche fatte dalla Admin Console
vivono nel volume `keycloak-db-data`: per ripartire da zero, rimuovere il volume
(`docker compose down -v`) — operazione distruttiva, solo in demo.

## Flusso di autenticazione

```
browser → GET /api/auth/login
        → 302 Keycloak /auth (state, nonce, code_challenge S256)
        → login tema crm-a
        → 302 /api/auth/callback?code&state
        → server: state cookie + code exchange (PKCE)
        → verifica ID token (RS256, JWKS, iss, aud, azp, exp, nonce)
        → ruoli da realm_access.roles ∩ matrice locale
        → cookie crm_a_session firmato (username + ruoli)
```

La console non vede mai la password. Se l'utente non ha ruoli CRM-A, il login
non viene accettato (`/login?error=no_role`).

Logout: `POST /api/auth/logout` cancella il cookie, poi `end_session_endpoint`
Keycloak chiude la sessione SSO e riporta a `/login`.

## Ruoli

| Ruolo realm | Permessi applicativi |
|---|---|
| `admin` | tutto: seed, utenti, audit, campagne |
| `communication` | segmenti, eleggibilità, crea/approva bozze |
| `membership` | profili, eleggibilità, membership |
| `infopoint` | profili, feedback e note infopoint |
| `relations` | organizzazioni e relazioni |

I nomi dei ruoli sono un contratto: `apps/web/lib/security/rbac.ts` li mappa sui
permessi `maxxi.*`. Ruoli extra nel realm vengono ignorati.

## Gestione utenti dalla console

`/maxxi/operators` (solo `admin`) usa il client confidential `crm-a-admin` con
service account. Il service account ha solo i ruoli realm-management necessari:

- `view-users`, `query-users`, `manage-users`, `view-realm`, `query-groups`.

Non ha `realm-admin`, non può modificare il realm, i client o le policy. La
creazione imposta nome/cognome di default (il profilo utente Keycloak li richiede)
e assegna i ruoli CRM-A. La console non salva password: le invia a Keycloak una
volta e non le rilegge.

## Tema di login personalizzato

```
deploy/keycloak/themes/crm-a/
└── login/
    ├── theme.properties          # parent=keycloak.v2, aggiunge crm-a.css
    └── resources/css/crm-a.css   # palette, tipografia, form, alert, footer
```

Scelte:

- **solo override cosmetici**: template e PatternFly restano quelli di
  `keycloak.v2`, così un aggiornamento di Keycloak non rompe la pagina;
- palette e tipografia riprese da `apps/web/app/globals.css`;
- dark mode via `prefers-color-scheme`, focus visibile, contrasto dei messaggi
  di errore;
- disclaimer fisso: “Demo non ufficiale — dati sintetici, nessun invio esterno”;
- nessun asset o marchio del MAXXI: il tema dice CRM-A, non impersona il museo.

Dopo una modifica al tema: `docker compose restart keycloak` (il tema è montato
read-only; la cache delle risorse cambia al riavvio).

Verifica rapida:

```bash
curl -sL -c /tmp/kc.jar -b /tmp/kc.jar \
  "http://localhost:8080/realms/crm-a/protocol/openid-connect/auth?client_id=crm-a-console&redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fapi%2Fauth%2Fcallback&response_type=code&scope=openid&state=x&nonce=y&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code_challenge_method=S256" \
  | grep -o 'crm-a/css/crm-a.css'
```

## Variabili d'ambiente

| Variabile | Significato |
|---|---|
| `CRM_A_OIDC_ISSUER` | issuer pubblico, deve combaciare con `iss` |
| `CRM_A_OIDC_INTERNAL_ISSUER` | issuer visto dal server (Docker: `http://keycloak:8080/...`) |
| `CRM_A_OIDC_CLIENT_ID` / `_SECRET` | client `crm-a-console` |
| `CRM_A_OIDC_REDIRECT_URI` | callback registrata (`/api/auth/callback`) |
| `CRM_A_OIDC_POST_LOGOUT_REDIRECT_URI` | ritorno dopo logout (`/login`) |
| `CRM_A_KEYCLOAK_ADMIN_CLIENT_ID` / `_SECRET` | client `crm-a-admin` |
| `CRM_A_SESSION_SECRET` | firma del cookie di sessione console |
| `CRM_A_SERVICE_TOKEN` | credenziale macchina per i tool agentici |

## Verifiche automatiche

```bash
pnpm --dir apps/web vitest run lib/security/oidc.test.ts \
  lib/security/keycloak-admin.test.ts app/api/auth/oidc-flow.test.ts
```

Coprono PKCE, verifica firma/claims, mapping ruoli, validazione input, client
admin (create/update/delete, ruoli riconciliati), fail-closed senza
configurazione, state/nonce errati, logout.

## Limiti noti

- `start-dev` + HTTP: solo locale. In produzione TLS obbligatorio e
  `KC_HOSTNAME` pubblico.
- I ruoli sono letti al login: modifica in Keycloak → effetto alla sessione
  successiva (TTL 12h).
- Revoca immediata: disattivare l'utente in Keycloak **e** ruotare
  `CRM_A_SESSION_SECRET` (invalida tutte le sessioni console).
- Il client secret demo è nel realm JSON: va sostituito prima di condividere
  l'ambiente.
