# Runbook demo — MAXXI Customer Intelligence (dati sintetici)

> **DEMO NON UFFICIALE — DATI SINTETICI — NESSUN INVIO ESTERNO.**
> Nessun dato appartiene a visitatori reali del MAXXI. Tutte le email usano
> `example.invalid`. I connettori sono simulati.

> **Copione completo per chi presenta:** [Guida per il presentatore](DEMO_PRESENTER_GUIDE.md).

## 1. Bootstrap locale

```bash
pnpm install --frozen-lockfile

# Segreti (impostali tu, non sono nel repo)
export CRM_A_SESSION_SECRET="$(openssl rand -hex 32)"
export CRM_A_SERVICE_TOKEN="$(openssl rand -hex 24)"
export CRM_A_DEMO_MODE=1

# Keycloak / OIDC (valori demo: cambiali prima di condividere l'ambiente)
export KEYCLOAK_ADMIN_PASSWORD="<password admin Keycloak>"
export KEYCLOAK_DB_PASSWORD="<password database Keycloak>"
export CRM_A_OIDC_CLIENT_SECRET="<client secret crm-a-console>"
export CRM_A_KEYCLOAK_ADMIN_CLIENT_SECRET="<client secret crm-a-admin>"

# Identità + database dedicato (il CRM resta su DuckDB)
docker compose up -d keycloak-db keycloak

pnpm build:crm-a-plugins
pnpm --dir apps/web dev      # oppure: docker compose up -d --build
```

Apri `http://localhost:3100` → redirect alla **login Keycloak** (tema CRM-A) →
username + password. La console non accetta password: senza Keycloak la
superficie resta chiusa (fail-closed).

Keycloak Admin Console: `http://localhost:8080` (solo localhost).
Realm `crm-a`. La password degli utenti demo è `demo-password-1`; è un valore di
demo, da cambiare in qualsiasi ambiente condiviso.

Senza `CRM_A_SESSION_SECRET` la console non può emettere sessioni; senza
`CRM_A_OIDC_*` il login risponde 503 e tutto il resto resta chiuso.

### Ruoli per la demo

| Account | Ruolo | Cosa vede |
|---|---|---|
| `admin.demo` | `admin` | tutto + Accessi + “Ricarica dati demo” |
| `comm.demo` | `communication` | segmenti, bozze/approvazioni; **non** le note infopoint |
| `memb.demo` | `membership` | profili e membership |
| `info.demo` | `infopoint` | profili + **note infopoint** |
| `rel.demo` | `relations` | organizzazioni e relazioni |

I ruoli si assegnano nel realm Keycloak. Da **/maxxi/operators** (solo admin) si
possono creare/modificare/disattivare utenti senza aprire la Admin Console; la
console usa un service account Keycloak con permessi minimi (`manage-users`).

## 2. Caricare i dati demo

Prima di caricare o ripresentare, aprire **Panoramica → Stato della demo**:
cinque controlli (accesso, dataset, invii esterni, provider AI, coda identità).
“Pronta” richiede che nessun controllo sia **Bloccante**; un avviso su provider
AI o coda identità è informativo.

Dalla UI: **Stato della demo → “Ricarica dati demo”** (solo `admin`). La UI
chiede una seconda conferma esplicita perché l’operazione cancella campagne,
versioni, snapshot, audit e decisioni demo. Gli altri ruoli ricevono 403/assenza
del comando.
Da terminale (stesso risultato, idempotente):

```bash
CRM_A_ADMIN_SESSION=<cookie crm_a_session di un admin> bash scripts/maxxi-demo.sh seed
CRM_A_SERVICE_TOKEN=<token> bash scripts/maxxi-demo.sh health
```

Il dataset vive in un DuckDB isolato (`<stateDir>/maxxi-demo/maxxi.duckdb`):
**seed e reset non toccano il workspace CRM condiviso**.

Reset completo = rieseguire il seed (ricostruisce le tabelle demo). Il seed non
tocca il workspace CRM condiviso né alcun dato reale.

## 3. I percorsi

Viste: `/maxxi` (panoramica), `/maxxi/people`, `/maxxi/sources`,
`/maxxi/segments`, `/maxxi/graph`, `/maxxi/campaigns`, `/maxxi/agent`.

### Percorso 1 — dal frammento alla persona (3')

1. `/maxxi/people?id=P-MARIA` → identità canonica, **due** fonti collegate
   (`site_form`, `mymaxxi_manual`) con regola e confidenza, timeline con
   `source_system:source_record_id` su ogni riga. Da qui **Vedi relazioni**
   apre il grafo centrato sulla persona.
2. Apri `P-MARIA-AMBIG`: resta una **persona distinta** e compare tra i
   candidati in revisione (`/maxxi/sources`), non viene fusa.
3. Nella timeline di Maria il biglietto `X-CALLE-2026` è un **acquisto**, non una
   visita; il ticket `T-ANON-001` non è attribuito a nessuno.

Da dire: *“Sappiamo perché un dato è collegato a questa persona, e quando non è
sicuro collegarlo.”*

### Percorso 2 — segmento, agente, bozza (4')

1. `/maxxi/segments` → contatori: eleggibili, esclusi per consenso, per identità,
   per dati mancanti. Ogni riga ha la motivazione.
2. `/maxxi/agent` → domanda:
   *“Quali visitatori interessati all’architettura hanno la myMAXXI in scadenza
   nei prossimi 45 giorni e consenso email?”*
   → conteggio esatto, finestra `2026-10-28 → 2026-12-12`, evidenze puntuali.
3. Prova *“Quanto hanno donato i sostenitori?”* → **“non ho evidenze
   sufficienti”** (nessun importo inventato).
4. `/maxxi/segments` → **Crea bozza (dry run)** oppure **Genera proposta AI**,
   controlla il testo e **spunta “Ho verificato mostra, date e assenza di
   promesse di invio”**, poi salva. Poi `/maxxi/campaigns` → **Dettaglio**:
   modifica la bozza (nuova versione), confronta le versioni e **Simula
   approvazione**. Verifica la snapshot dei destinatari e la riga di audit.

Da dire: *“La macchina propone, l’umano approva; in demo non parte nulla.”*

### Percorso 3 — membership, infopoint, sostenitori (3')

1. `/maxxi/people?id=P-GIULIA` → card myMAXXI (scadenza), visita attribuita,
   feedback infopoint aperto.
2. `/maxxi/agent` → *“Chi è Giulia Bianchi?”* → riepilogo con fonti e stato
   identità.
3. Nello stesso profilo, sezione **Organizzazioni**: relazione demo con
   l’organizzazione sostenitrice fittizia (nessun importo).

### Percorso 4 — grafo delle relazioni (2')

1. `/maxxi/people?id=P-MARIA` → **Vedi relazioni**.
2. Il grafo si apre centrato su Maria con fonti, interessi, mostre e
   l’arco **Possibile duplicato**.
3. Clic su un nodo (es. `X-ARCH-2026`) → dettaglio; su una persona compare
   **Apri profilo 360**.
4. Filtri per tipo e **Mostra tutto** per la vista completa (15 nodi, 23
   relazioni nel fixture).

Da dire: *“Il grafo rende visibili le connessioni, ma non trasforma un
possibile duplicato in un’identità confermata. Legge solo il database demo e
non espone le note infopoint.”*

Ogni tappa del percorso mostra una **sintesi narrativa**: la domanda, l’evidenza
a schermo e l’azione successiva. Usarla come filo conduttore, non come slide.

La prima apertura può richiedere qualche secondo; i dettagli successivi usano
la cache. Il ruolo `relations` non ha accesso al grafo delle persone.

---

## 4. Azioni dell’agente (tool)

Estensione `crm-a-maxxi` (richiede `CRM_A_SERVICE_TOKEN`):

| Tool | Tipo | Note |
|---|---|---|
| `maxxi_person_360` | read-only | profilo, fonti, timeline, consensi |
| `maxxi_segment_arch_renewal` | read-only | segmento deterministico + ragioni |
| `maxxi_campaign_proposal` | **dry-run** | crea solo una bozza + audit, richiede `confirm: true` |

Nessun tool può inviare email, messaggi o avviare chiamate.

## 4b. Pubblicazione con zrok (opzionale)

Per esporre console e Keycloak tramite due share zrok, seguire
`docs/maxxi/ZROK.md` e avviare:

```bash
docker compose --profile zrok up -d --build
```

L’avvio locale senza profilo resta su `127.0.0.1`.

## 5. Cosa NON è reale

- Connettori Archeoares / myMAXXI / biblioteca / infopoint / Matomo / social:
  **simulati**, con tracciati inventati.
- Mostre: `Vitalità dell’architettura italiana 1946-2026` e
  `Sophie Calle - Matrimoni, Rotture e Funerali inclusi` sono voci di catalogo
  pubblico reale; presenze e interesse sono inventati.
- Nessuna email/SMS/telefonata viene inviata; gli adapter sono bloccati in
  demo mode.
- La dashboard non mostra statistiche hardcoded: tutti i numeri derivano dal
  dataset con orologio fisso `2026-10-28T12:00+01:00`.

## 6. Stop

```bash
docker compose down          # oppure Ctrl-C su `pnpm dev`
```

Per rimuovere solo i dati demo: rieseguire il seed con il fixture azzerato, oppure
cancellare `<stateDir>/maxxi-demo/` (non tocca il workspace CRM).
