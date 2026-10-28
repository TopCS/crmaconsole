# Runbook demo — MAXXI Customer Intelligence (dati sintetici)

> **DEMO NON UFFICIALE — DATI SINTETICI — NESSUN INVIO ESTERNO.**
> Nessun dato appartiene a visitatori reali del MAXXI. Tutte le email usano
> `example.invalid`. I connettori sono simulati.

## 1. Bootstrap locale

```bash
pnpm install --frozen-lockfile

# Segreti operatore (impostali tu, non sono nel repo)
export CRM_A_SESSION_SECRET="$(openssl rand -hex 32)"
export CRM_A_OPERATOR_PASSWORD="<password a tua scelta, >=8 caratteri>"
export CRM_A_SERVICE_TOKEN="$(openssl rand -hex 24)"
export CRM_A_DEMO_MODE=1

pnpm build:crm-a-plugins
pnpm --dir apps/web dev      # oppure: docker compose up -d --build
```

Apri `http://localhost:3100` → redirect a `/login` → inserisci la password
operatore. Senza `CRM_A_SESSION_SECRET` + `CRM_A_OPERATOR_PASSWORD` il login è
disabilitato e l'intera superficie resta chiusa (fail-closed).

## 2. Caricare i dati demo

Dalla UI: **Panoramica → “Ricarica dati demo”**.
Da terminale (stesso risultato, idempotente):

```bash
bash scripts/maxxi-demo.sh seed
bash scripts/maxxi-demo.sh health
```

Il dataset vive in un DuckDB isolato (`<stateDir>/maxxi-demo/maxxi.duckdb`):
**seed e reset non toccano il workspace CRM condiviso**.

Reset completo = rieseguire il seed (ricostruisce le tabelle demo).

## 3. I tre percorsi

Viste: `/maxxi` (panoramica), `/maxxi/people`, `/maxxi/sources`,
`/maxxi/segments`, `/maxxi/campaigns`, `/maxxi/agent`.

### Percorso 1 — dal frammento alla persona (3')

1. `/maxxi/people?id=P-MARIA` → identità canonica, **due** fonti collegate
   (`site_form`, `mymaxxi_manual`) con regola e confidenza, timeline con
   `source_system:source_record_id` su ogni riga.
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
4. `/maxxi/segments` → **Crea bozza (dry run)** → poi `/maxxi/campaigns` →
   **Simula approvazione** → la riga di audit compare in fondo.

Da dire: *“La macchina propone, l’umano approva; in demo non parte nulla.”*

### Percorso 3 — membership, infopoint, sostenitori (3')

1. `/maxxi/people?id=P-GIULIA` → card myMAXXI (scadenza), visita attribuita,
   feedback infopoint aperto.
2. `/maxxi/agent` → *“Chi è Giulia Bianchi?”* → riepilogo con fonti e stato
   identità.
3. Nello stesso profilo, sezione **Organizzazioni**: relazione demo con
   l’organizzazione sostenitrice fittizia (nessun importo).

## 4. Azioni dell’agente (tool)

Estensione `crm-a-maxxi` (richiede `CRM_A_SERVICE_TOKEN`):

| Tool | Tipo | Note |
|---|---|---|
| `maxxi_person_360` | read-only | profilo, fonti, timeline, consensi |
| `maxxi_segment_arch_renewal` | read-only | segmento deterministico + ragioni |
| `maxxi_campaign_proposal` | **dry-run** | crea solo una bozza + audit, richiede `confirm: true` |

Nessun tool può inviare email, messaggi o avviare chiamate.

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
