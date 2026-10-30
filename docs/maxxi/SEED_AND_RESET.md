# Seed e reset — workspace demo MAXXI

## Dove vivono i dati

| Elemento | Percorso |
|---|---|
| Database demo | `<OPENCLAW_STATE_DIR>/maxxi-demo/maxxi.duckdb` |
| Override directory | `CRM_A_MAXXI_DB_DIR` |
| Fixture | `docs/fixtures/maxxi_demo_seed.json` (override: `CRM_A_MAXXI_FIXTURE`) |

Il DB demo è **separato** dal workspace CRM: nessun seed o reset tocca
`<stateDir>/workspace/workspace.duckdb` o altre cartelle workspace.

## Comandi

```bash
# da UI: Panoramica → “Ricarica dati demo” (solo admin)
# da terminale (health usa il token di servizio):
CRM_A_SERVICE_TOKEN=... bash scripts/maxxi-demo.sh health
# seed: serve il cookie di sessione di un admin, non una credenziale macchina
CRM_A_ADMIN_SESSION=... bash scripts/maxxi-demo.sh seed
```

`POST /api/maxxi/seed` richiede il permesso `maxxi.seed`, cioè un operatore con
ruolo `admin`. Il token di servizio è deliberatamente escluso: non può
ricostruire o cancellare il dataset demo.

## Idempotenza

Il seed **ricostruisce** le tabelle demo dal fixture:

1. `ensureMaxxiSchema()` crea le tabelle se assenti (`CREATE TABLE IF NOT EXISTS`);
2. `resetMaxxiDemo()` esegue `DELETE FROM` su tutte le tabelle demo;
3. reinserisce i record con ID deterministici (derivati da `source_record_id`).

Rieseguire il seed produce gli stessi conteggi: nessun evento o persona
duplicato. Verificato dal test `seed.test.ts` → *“is idempotent: a second run
yields identical counts”*.

## Conteggi attesi (fixture di riferimento)

| Entità | Conteggio |
|---|---|
| persone | 200 |
| membership myMAXXI | 167 |
| eventi | 399 |
| record di fonte | 444 |
| identity link creati | 425 |
| candidati in revisione | 9 (incluso `P-MARIA-AMBIG`) |
| consensi | 200 |
| casi infopoint | 42 |
| organizzazioni | 9 |
| relazioni organizzazione | 33 |
| voci di catalogo | 2 |

Le otto persone di riferimento (`P-MARIA`, `P-MARIA-AMBIG`, `P-GIULIA`,
`P-ELENA`, `P-PAOLO`, `P-LUCA`, `P-SARA`, `P-GIOVANNI`) restano invariate: il
dataset espanso aggiunge visitatori coerenti attorno a quel nucleo narrativo.

## Reset completo

Rieseguire il seed. In alternativa, eliminare la directory demo:

```bash
rm -rf "${OPENCLAW_STATE_DIR:-$HOME/.openclaw-crm-a}/maxxi-demo"
```

Non elimina il workspace CRM né le configurazioni delle integrazioni.

## Orologio

La demo usa un clock fisso `2026-10-28T12:00:00+01:00` (`MAXXI_CLOCK_ISO`). Tutti
i KPI e i segmenti sono calcolati su quel riferimento, così la demo e i test sono
riproducibili.
