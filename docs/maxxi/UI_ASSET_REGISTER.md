# UI Asset Register — MAXXI demo

> Registro degli asset visivi usati nella demo. Obiettivo: nessun asset senza
> provenienza e diritto d'uso. Il progetto è una **demo non ufficiale**: il nome
> MAXXI è usato in modo descrittivo, non come marchio del museo.

## Asset usati

| Asset | File / origine | Licenza / permesso | Ruolo UI |
|---|---|---|---|
| Wordmark `MAXXI / Customer Intelligence` | testo in `apps/web/app/maxxi/shell.tsx` | nessun asset esterno; testo originale della demo | header sidebar |
| Font display/body | stack `Inter, "Helvetica Neue", Arial, sans-serif` / `Inter, system-ui, …` | font di sistema o Inter se già installato; nessun file distribuito dal repo | tipografia |
| Icone | caratteri Unicode (`☰`, `×`, `→`) e CSS | nessuna libreria esterna aggiunta | menu, logout, stato |
| Grafico “Pubblico nel tempo” | SVG generato da `apps/web/app/maxxi/page.tsx` | dati sintetici del fixture | KPI/trend |
| Screenshot QA | `docs/maxxi/screenshots/*.png` | generati da Chrome headless sul dataset sintetico | QA, non uso pubblico |

## Asset deliberatamente non usati

| Asset | Motivo |
|---|---|
| Logo MAXXI e frame `XXI` | marchio proprietario; richiede autorizzazione e non va ridisegnato |
| Font Maison / Miller | font commerciali, nessuna licenza di distribuzione |
| Fotografie di mostre o architettura | nessun asset licenziato nel repository |
| Immagini da CDN esterne | evitare dipendenze e problemi di licenza |
| Icon set decorativo | la specifica vieta icone puramente decorative |

## Provenienza dei dati mostrati

- Tutti i dati sono sintetici e provengono da `docs/fixtures/maxxi_demo_seed.json`.
- Le mostre citate (`Vitalità dell'architettura italiana 1946-2026`, `Sophie
  Calle — Matrimoni, Rotture e Funerali inclusi`) sono informazioni pubbliche
  del catalogo; presenze, acquisti e consensi sono inventati.
- Nessuna fotografia, logo o font è stato scaricato durante l'implementazione.

## Screenshot

Gli screenshot in `docs/maxxi/screenshots/` sono stati prodotti con Chrome
headless (Playwright) su viewport 1440×900 e 375×812, con login Keycloak e
dataset demo. Non contengono dati personali reali.

Se in futuro il committente fornirà logo, font o fotografie autorizzate, questo
registro va aggiornato **prima** dell'uso, indicando file, fonte, licenza e
responsabile dell'autorizzazione.
