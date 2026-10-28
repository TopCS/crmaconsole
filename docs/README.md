# Handoff pronto per harness - CRM-A Console / CDP MAXXI

**Apri e incolla `00_START_HERE_HARNESS.md` nel tuo harness** (Fusion, opencode, Claude Code, ecc.). Allega a quello stesso workspace il contenuto completo di questa directory o il file ZIP.

## Cosa contiene

| File | Uso |
|---|---|
| `00_START_HERE_HARNESS.md` | Prompt principale: istruzioni eseguibili e gate di completamento |
| `01_PLATFORM_EVOLUTION.md` | Miglioramenti CRM-A Console, sicurezza, API, customer memory, roadmap |
| `02_MAXXI_DEMO_PRD.md` | Requisiti della demo verticale e 3 scenari |
| `03_MAXXI_DATA_CONTRACT.md` | Fonti, eventi, identity resolution, membership, consenso, lineage |
| `04_ACCEPTANCE_AND_DEMO_SCRIPT.md` | Test negativi/positivi, demo da 12 minuti, go/no-go |
| `task_manifest.yaml` | Task machine-readable con dipendenze, priorita', output e accettazione |
| `fixtures/maxxi_demo_seed.json` | Dataset fittizio e oracoli deterministici di test |
| `fixtures/sources/*.csv` | Esempi sintetici di file di sorgente, NON tracciati originali |
| `sources/*.pdf` | Tre documenti originali forniti dal committente |

## Come usarlo

1. Apri il repository `TopCS/crmaconsole` nel tuo harness.
2. Allega o monta questo pacchetto nel workspace dell'harness.
3. Dai come primo messaggio il contenuto di `00_START_HERE_HARNESS.md`.
4. Imposta il lavoro in fasi e non saltare G1 (sicurezza), anche se inizialmente si lavora in locale.
5. Richiedi il `DELIVERY_REPORT.md` prima di usare la demo con un cliente.

## Messaggio chiave

Il cliente chiede un CRM, ma l'offerta tecnica e' una **CDP con intelligenza relazionale e agenti**, cioe' profilo visitatore 360, deduplica, eventi, consenso, segmenti, attivazione controllata, memoria delle relazioni e interoperabilita'. OpenClaw resta il runtime; non duplicarlo.

## Stato di avanzamento

Questo ZIP e' un **handoff di implementazione**, non un'applicazione gia' sviluppata, testata o distribuita. I risultati descritti sono il **target** dell'harness. Nessuna modifica al repository GitHub e' stata effettuata dalla preparazione del pacchetto.
