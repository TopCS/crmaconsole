# UI QA — MAXXI demo

Data verifica: **28 ottobre 2026**  
Browser: Chrome headless (Playwright 1.58)  
Viewport: **1440×900** desktop, **375×812** mobile  
Dati: fixture sintetico, login Keycloak `admin.demo`  
Ambiente: build di produzione Next.js servita su `http://localhost:3100`

## Esito UX-001 … UX-010

| ID | Test | Esito | Evidenza / note |
|---|---|---|---|
| UX-001 | Tema MAXXI solo nel workspace MAXXI | **PASS** | `/maxxi` ha `[data-workspace-theme="maxxi"]`; `/workspace` no. Body standard `rgb(245,245,244)`, accent `#0065A2` invariati. |
| UX-002 | Dashboard desktop 1440×900 | **PASS** | Titolo, 4 KPI primari, fonti, grafico e ribbon demo visibili; `overflowX = 0`. |
| UX-003 | Profilo 360 | **PASS** | Timeline, provenienza, myMAXXI, consensi, interessi e organizzazioni distinguibili; nessuno scroll orizzontale. |
| UX-004 | Segmenti / consensi | **PASS** | “Consenso mancante o revocato” e gli altri motivi sono testuali, non solo colore; conteggi per motivo. |
| UX-005 | Campagna demo | **PASS** | Banner “nessuna comunicazione sarà inviata”, stepper 1–5, CTA “Crea bozza (dry run)” e “Simula approvazione”; nessun pulsante di invio. |
| UX-006 | Mobile 375×812 / tablet | **PASS (mobile)** | Nessun overflow globale; drawer con `aria-expanded`, overlay ed Escape; target CSS ≥44px. Tablet non catturato come screenshot separato. |
| UX-007 | Accessibilità | **PARZIALE** | Skip link, focus ring, landmark, `aria-current`, `aria-live`, caption e tabella `sr-only` per il grafico. Contrasto non misurato con axe/Lighthouse in questa sessione. |
| UX-008 | Asset provenance | **PASS** | Nessun logo/font/foto proprietari; registro in `UI_ASSET_REGISTER.md`. |
| UX-009 | Data transparency | **PASS** | “Dati dimostrativi” in panoramica e nelle note; nessun `170.000` come valore realtime; acquisti distinti dalle visite. |
| UX-010 | Dark mode | **PASS (dichiarato)** | Tema MAXXI light-first con `color-scheme: light`; dark non implementato nello scope. Il tema standard resta invariato. |

## Screenshot

| File | Vista | Viewport |
|---|---|---|
| `screenshots/01-overview-desktop.png` | Panoramica | 1440×900 |
| `screenshots/02-profile-desktop.png` | Visitatore 360 (`P-MARIA`) | 1440×900 |
| `screenshots/03-sources-desktop.png` | Fonti e qualità | 1440×900 |
| `screenshots/04-segments-desktop.png` | Segmenti | 1440×900 |
| `screenshots/05-campaigns-desktop.png` | Campagne | 1440×900 |
| `screenshots/06-agent-desktop.png` | Assistente | 1440×900 |
| `screenshots/06b-agent-answer.png` | Assistente con risposta grounded | 1440×900 |
| `screenshots/06c-agent-chat.png` | Assistente, modalità Chat AI | 1440×900 |
| `screenshots/07-operators-desktop.png` | Accessi | 1440×900 |
| `screenshots/08-standard-workspace.png` | Workspace standard (non-regressione) | 1440×900 |
| `screenshots/09-overview-mobile.png` | Panoramica | 375×812 |
| `screenshots/10-mobile-drawer.png` | Drawer di navigazione | 375×812 |
| `screenshots/11-profile-mobile.png` | Visitatore 360 (`P-GIULIA`) | 375×812 |

## Misure raccolte

| Controllo | Desktop | Mobile |
|---|---|---|
| Overflow orizzontale documento | 0 px | 0 px |
| Sidebar background | `rgb(8, 8, 8)` | `rgb(8, 8, 8)` |
| Ribbon demo | presente | presente |
| Drawer | n/a | `data-open="true"`, `aria-expanded="true"` |
| Scope MAXXI | presente | presente |
| Errori console (produzione) | 0 | 0 |

## Limiti dichiarati

- **Nessuna verifica con axe/Lighthouse**: UX-007 resta parziale finché non si
  esegue un audit automatico del contrasto e dei ruoli ARIA.
- **Tablet 768×1024** non ha uno screenshot dedicato; il layout usa gli stessi
  breakpoint del mobile/desktop.
- **Dark mode MAXXI** non esiste: è una scelta esplicita, non una regressione.
- **Viste separate** `myMAXXI`, `Mostre`, `Infopoint`, `Sostenitori` non sono
  state create in questa tranche: i contenuti sono dentro le viste esistenti
  (vedi `UI_DESIGN_SYSTEM.md`, §7).
- Gli screenshot sono generati con Chrome headless: eventuali differenze di
  font rispetto a un desktop con Inter installato sono attese e documentate.
