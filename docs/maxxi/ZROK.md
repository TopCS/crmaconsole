# Pubblicazione con zrok

La pubblicazione è **opzionale** e vive nel profilo Compose `zrok`: l’avvio
locale normale resta chiuso su `127.0.0.1`.

Servono due share pubblici distinti:

| Share | Target interno | URL predefinito |
|---|---|---|
| Console CRM-A | `http://crm-a-console:3100` | `https://crm-a-console.share.zrok.io` |
| Keycloak (OIDC) | `http://keycloak:8080` | `https://crm-a-keycloak.share.zrok.io` |

## Prerequisiti

1. Account zrok e relativo `ZROK_ENABLE_TOKEN`.
2. Nomi share coerenti con gli URL usati da Keycloak e dalla console.
3. Se si cambiano i nomi predefiniti, aggiornare nel realm
   `crm-a-console`:
   - `redirectUris`: `<console>/api/auth/callback`
   - `webOrigins`: `<console>`
   - `post.logout.redirect.uris`: `<console>/login`

Il realm versionato contiene già gli URL predefiniti
`crm-a-console.share.zrok.io`.

## Configurazione `.env`

```bash
# zrok
export ZROK_ENABLE_TOKEN="<token>"
export ZROK_API_ENDPOINT="https://api.zrok.io"
export ZROK_ENVIRONMENT_NAME="crm-a"
export ZROK_UNIQUE_NAME="crm-a-console"
export ZROK_KEYCLOAK_UNIQUE_NAME="crm-a-keycloak"

# URL pubblici
export CRM_A_PUBLIC_URL="https://crm-a-console.share.zrok.io"
export CRM_A_KEYCLOAK_PUBLIC_URL="https://crm-a-keycloak.share.zrok.io"
export CRM_A_KEYCLOAK_ADMIN_URL="http://localhost:8080"

# OIDC: issuer pubblico = Keycloak pubblico; chiamate server = keycloak:8080
export CRM_A_OIDC_ISSUER="https://crm-a-keycloak.share.zrok.io/realms/crm-a"
export CRM_A_OIDC_INTERNAL_ISSUER_DOCKER="http://keycloak:8080/realms/crm-a"
export CRM_A_OIDC_CLIENT_ID="crm-a-console"
export CRM_A_OIDC_CLIENT_SECRET="<client secret>"
export CRM_A_OIDC_REDIRECT_URI="https://crm-a-console.share.zrok.io/api/auth/callback"
export CRM_A_OIDC_POST_LOGOUT_REDIRECT_URI="https://crm-a-console.share.zrok.io/login"
```

## Avvio

```bash
docker compose --profile zrok up -d --build
```

Il profilo avvia, per ciascuno share:

1. `zrok-*-init` — prepara la directory persistente;
2. `zrok-*-enable` — registra l’ambiente zrok;
3. `zrok-*` — avvia il proxy pubblico.

Directory persistenti:

- `deploy/zrok/console/`
- `deploy/zrok/keycloak/`

Non contengono segreti nel repository e sono escluse da Git.

## Keycloak in modalità server

Il Compose usa `start`, non `start-dev`:

- `KC_HOSTNAME` = URL pubblico zrok;
- `KC_HOSTNAME_STRICT=true`;
- `KC_HOSTNAME_STRICT_BACKCHANNEL=false`, così la console può chiamare
  `http://keycloak:8080` per token e JWKS;
- `KC_HOSTNAME_ADMIN=http://localhost:8080`: l’Admin Console resta locale e
  **non** viene pubblicata via zrok;
- `KC_PROXY_HEADERS=xforwarded`: zrok termina TLS e Keycloak si fida degli
  header inoltrati.

## Verifica

```bash
docker compose --profile zrok ps
docker compose logs -f zrok-console zrok-keycloak
```

Poi aprire l’URL pubblico della console: deve reindirizzare al Keycloak
pubblico e tornare al callback pubblico.

Controlli minimi:

- login con un account demo;
- `GET /api/auth/me` restituisce il ruolo;
- una pagina `/maxxi` si apre;
- la modalità demo è attiva (`CRM_A_DEMO_MODE=1`);
- l’Admin Console è raggiungibile solo da `http://localhost:8080`.

## Limiti e sicurezza

- zrok pubblica l’intera superficie Keycloak sul secondo host: le API OIDC
  servono al browser, ma **non** va considerata un’esposizione di produzione.
  L’Admin Console resta locale grazie a `KC_HOSTNAME_ADMIN`, ma le regole di
  filtro path di zrok non sono un WAF.
- Le credenziali demo (`demo-password-1`) e i client secret del realm sono
  valori di demo: vanno sostituiti prima di condividere gli URL.
- TLS termina su zrok; il traffico interno console ↔ Keycloak resta HTTP sulla
  rete Compose.
- La demo continua a bloccare ogni invio reale; l’esposizione non cambia questa
  regola.
- Se si cambiano i nomi zrok, aggiornare il realm e riavviare Keycloak o
  applicare le modifiche via Admin API.
