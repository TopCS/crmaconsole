# ADR-ROADMAP — decisioni per gli sprint successivi

Questo documento è **propositivo**: nulla qui è implementato nella demo, salvo
dove marcato *implementato*. Serve a evitare che i prossimi sprint ripetano le
stesse scelte o rompano i gate già chiusi.

---

## ADR-101 — API v1 `/api/v1/cdp/*`

**Stato:** proposto (façade interna già *implementata* in `lib/maxxi/queries.ts`).

Decisione: esporre REST versionata sopra la façade, non sopra DuckDB.

- Contratto: `getPerson360`, `listPersonEvents`, `listSegmentMembers`,
  `getMembershipStatus`, `previewCampaign`, `recordActionProposal`,
  `approveProposal`.
- Il `principal` arriva **dal server** (sessione/token), mai dal body.
- Paginazione a cursore, `limit` massimo, payload validato con schema.
- OpenAPI generato dal codice, versionato.

Perché: i componenti oggi parlano con EAV e route ad hoc; senza façade ogni nuova
feature duplica query e controlli. Il risk è basso: la façade esiste già e i test
coprono i contratti.

**Attenzione:** introdurre v1 senza RBAC significa esporre gli stessi dati con un
contratto più stabile. Va fatto dopo ADR-102.

---

## ADR-102 — RBAC e audit per record

**Stato:** *parzialmente implementato* (RBAC a grana grossa) — audit per record ancora proposto.

Implementato in questa tranche:
- identità delegata a **Keycloak** (ADR-107): ruoli
  `admin` / `communication` / `membership` / `infopoint` / `relations` nel realm;
- permessi risorsa.azione (`lib/security/rbac.ts`) applicati lato server da
  `guardPermission()`, non solo nascosti in UI;
- note infopoint mascherate per i ruoli senza `maxxi.feedback.viewNotes`;
- pagine con vincolo di ruolo (`/maxxi/operators`) redirette dal middleware;
- audit di seed, bozze, approvazioni, creazione/modifica/eliminazione utenti con
  username reale (non più account locali).

Ancora da fare (proposto): autorizzazione **per record** (es. un operatore
Infopoint vede solo i casi assegnati a lui), revoca sessioni immediata,
audit delle *letture* sensibili. Le policy per record si appoggeranno a
PostgreSQL/RLS (ADR-104).

Vincoli mantenuti: nessun ruolo finto in UI, ogni endpoint dichiara il permesso,
test negativi per ruolo nella suite (`app/api/maxxi/rbac.test.ts`).

---

## ADR-103 — Memoria cliente temporale

**Stato:** proposto (contratto definito in `03_MAXXI_DATA_CONTRACT.md`).

Decisione: 1-2 fatti storicizzati, non un graph engine.

```
fact_id, subject_id, predicate, object_value | object_ref,
source_system, source_record_id, evidence_ref, confidence,
observed_at, valid_from, valid_to, recorded_at, supersedes, status,
tenant_id/workspace_id, purpose, sensitivity, retention_class
```

Primo caso: iscrizione myMAXXI valida per periodo (`valid_from`/`valid_to`), con
provenienza visibile in UI e query deterministica. Secondo: consenso per
scopo/canale con `withdrawn_at`.

**Non** costruire un database temporale dedicato: usare colonne e una vista.

---

## ADR-104 — PostgreSQL vs DuckDB

**Stato:** *decisione presa* (PostgreSQL per il dato operativo + RLS) — migrazione da pianificare.

Contesto: ~170k record dichiarati nel 2024 (non certificati), multiutente,
transazioni, concorrenza in scrittura, retention/portabilità. Keycloak usa già
PostgreSQL dedicato (`keycloak-db`), quindi l'infrastruttura è nota.

Decisione: il dato operativo e le **policy di autorizzazione per record** vivono
in PostgreSQL; DuckDB resta per analytics/export e per il dataset demo isolato.
Le policy saranno **Row-Level Security** sul ruolo applicativo, non `WHERE`
sparso nel codice:

- `tenant_id`/`workspace_id` e `purpose` su ogni tabella con dato personale;
- ruolo applicativo `crm_app` senza `BYPASSRLS`;
- policy per ruolo CRM-A (es. Infopoint limitato ai casi assegnati);
- `SET LOCAL app.principal_id` per ogni transazione, così l'audit è coerente;
- i controlli applicativi restano (difesa in profondità), non vengono rimossi.

Architettura **ibrida**, non sostituzione.

| Carico | Storage |
|---|---|
| Scritture operative multiutente, transazioni, RBAC | PostgreSQL |
| Analytics/aggregati su grandi volumi, export | DuckDB (parquet) |

Prima di decidere serve un **benchmark** su dataset sintetico equivalente, con
misure su: latenza p95 delle viste, concorrenza in scrittura, costo di
migrazione. La boundary è già pronta: `lib/maxxi/queries.ts` è l'unico punto che
conosce il DB demo.

Rischi: doppia verità, drift di schema, costo operativo. Mitigazione: una sola
façade, migrazioni additive, contract test.

---

## ADR-105 — MCP server

**Stato:** proposto, **non** implementato.

Perché non ora: un server MCP è un secondo perimetro di autenticazione. Servono
scope per tool, revoca, rate limit per client e human-in-the-loop sulle
scritture. Aprirlo prima di ADR-102 significherebbe duplicare il gate.

Quando: dopo RBAC. Forma consigliata:

- tool **read-only** separati (`cdp_person_360`, `cdp_segment_members`);
- tool di **proposta** senza side effect esterni (`cdp_campaign_proposal`);
- nessun tool con invio reale;
- scope OAuth per client, con audit per chiamata.

---

## ADR-106 — Integrazioni reali (Archeoares, myMAXXI, biblioteca, infopoint)

**Stato:** proposto. Oggi tutto è **mock dichiarato**.

Da chiarire con il committente prima di scrivere codice:

1. Formato reale dei report biglietteria (XLS giornaliero?) e presenza di
   identificativi individuali.
2. Esistenza di un ID comune tra biblioteca e myMAXXI (oggi: **namespace
   distinti**, nessun merge).
3. Base giuridica e consenso per riuso dei dati di erogazione del servizio in
   finalità marketing.
4. Retention per tipo di fonte.
5. Accesso (API, SFTP, export manuale) e frequenza.

Senza queste risposte, qualsiasi "integrazione" sarebbe una finzione: il PRD la
vieta.

---

## ADR-107 — Identità delegata a Keycloak (OIDC)

**Stato:** *implementato*.

Decisione: la console non gestisce password. Keycloak è l'unico IdP, con
PostgreSQL dedicato e realm versionato in `deploy/keycloak/realm/crm-a-realm.json`.

- flusso **Authorization Code + PKCE (S256)**, `state` + `nonce` in cookie
  httpOnly a vita breve;
- ID token verificato con JWKS (RS256) e controlli su `iss`, `aud`/`azp`, `exp`,
  `nonce`; ruoli da `realm_access.roles` filtrati sulla matrice locale;
- sessione console firmata HMAC con username + ruoli, così middleware, guard e
  audit restano invariati;
- logout locale + `end_session_endpoint` Keycloak (SSO terminato);
- client `crm-a-admin` con service account limitato a `view-users`/
  `query-users`/`manage-users` per la pagina Accessi;
- login personalizzata con tema `crm-a` (estende `keycloak.v2`, palette e
  tipografia della console), verificata dopo gli aggiornamenti.

Limiti dichiarati: `start-dev` e HTTP locale solo per demo; i ruoli sono letti al
login (TTL 12h); la revoca immediata richiede disattivazione in Keycloak +
rotazione di `CRM_A_SESSION_SECRET`.

---

## Ordine consigliato

1. **ADR-104 (PostgreSQL + RLS)** — abilita l'autorizzazione per record.
2. **ADR-101 (API v1)** — sopra la façade già esistente.
3. **ADR-103 (memoria temporale)** — 1-2 fatti, con provenienza.
4. **ADR-105 (MCP)** — solo dopo 102/104.
5. **ADR-106 (integrazioni)** — dipende dal committente, non dal codice.

## Non-goals (riconfermati)

Migrazione dei 170k record, invii reali, pagamenti, app mobile, arricchimento
social automatico, inferenze psicografiche, sostituzione del CRM Aruba.
