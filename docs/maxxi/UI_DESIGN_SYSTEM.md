# UI Design System — MAXXI demo

> Specifica applicata: `docs/05_MAXXI_UI_LOOK_AND_FEEL.md` e
> `docs/ui/maxxi-theme.reference.css`. I valori sono **token di demo**, non un
> brand book ufficiale del museo. Nessun logo, font o fotografia del MAXXI è
> stato usato.

## 1. Perimetro del tema

Il tema è attivo **solo** dentro il layout `/maxxi`:

```tsx
// apps/web/app/maxxi/shell.tsx
<div data-workspace-theme="maxxi" className="maxxi-shell">
```

Nessun token è stato aggiunto a `:root` o `.dark`. Gli altri workspace CRM-A
mantengono `--color-accent: #0065A2`, sfondo `#f5f5f4` e componenti invariati
(verificato in UI_QA, UX-001).

La modalità scura non è implementata nella demo: il wrapper imposta
`color-scheme: light`, quindi il workspace MAXXI resta leggibile anche se il
tema globale è scuro. Il toggle globale non viene nascosto, ma il tema MAXXI non
lo segue: scelta dichiarata, non una UI a metà.

## 2. Token

| Token | Valore | Uso |
|---|---|---|
| `--maxxi-black` | `#080808` | sidebar, banda demo |
| `--maxxi-ink` | `#111111` | testo, CTA primaria, bordi attivi |
| `--maxxi-paper` | `#ffffff` | card, top bar |
| `--maxxi-canvas` | `#f6f6f4` | sfondo contenuto |
| `--maxxi-line` | `#d7d7d4` | bordi e separatori |
| `--maxxi-line-strong` | `#adada9` | bordi input e header tabella |
| `--maxxi-muted` | `#555553` | testo secondario |
| `--maxxi-selected` | `#eaeae7` | hover riga, selezione |
| `--maxxi-focus` | `#165cc4` | focus ring (utility, non brand) |
| `--maxxi-positive` | `#236545` | stati positivi |
| `--maxxi-warning` | `#9b5a0c` | revisione / dati simulati |
| `--maxxi-negative` | `#a53232` | errori, consenso revocato |
| `--maxxi-radius` | `4px` | card, input, dialog |

I token CRM-A (`--color-*`) sono rimappati **solo dentro lo scope**, così i
componenti esistenti ereditano il tema senza fork.

## 3. Tipografia

```css
--maxxi-display: Inter, "Helvetica Neue", Arial, sans-serif;
--maxxi-body: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
```

Inter non viene scaricato da CDN: se non è installato si usa il fallback di
sistema, come previsto dalla specifica. Nessun font proprietario (Maison,
Miller) è stato incluso.

| Ruolo | Implementazione |
|---|---|
| Page display | `.maxxi-display`, `clamp(2rem, 4vw, 2.75rem)`, peso 740, tracking −0.04em |
| H2 sezione | `.maxxi-section-title`, 1.15rem, peso 700 |
| Eyebrow | `.maxxi-eyebrow`, 11px, uppercase, tracking 0.14em |
| Body | 14–15px, interlinea 1.5 |
| KPI | `.maxxi-kpi-value`, `tabular-nums`, peso 740, 26–44px |
| Tabella | 13.5px; header 10.5px uppercase |

## 4. Shell

| Elemento | Implementazione |
|---|---|
| Sidebar | 248px, `#080808`, sticky su desktop, drawer su <1024px |
| Wordmark | `MAXXI` + `CUSTOMER INTELLIGENCE`, tipografico, nessun logo |
| Navigazione | gruppi `Intelligence`, `Pubblico`, `Attivazione`, `Strumenti`; il grafo è visibile ai ruoli con accesso ai profili |
| Voce attiva | sfondo `#242424`, barra bianca 3px, `aria-current="page"` |
| Top bar | 64px, breadcrumb, stato demo, utente |
| Ribbon | banda nera persistente `DEMO · DATI SINTETICI · NESSUN INVIO ESTERNO` |
| Contenuto | max 1360px, padding 32/24px desktop, 24/16px mobile |
| Drawer mobile | overlay, chiusura con Escape, focus al primo link, `aria-expanded` |
| Skip link | “Vai al contenuto” verso `#maxxi-main` |

## 5. Componenti

| Componente | File | Note |
|---|---|---|
| `MaxxiShell` | `apps/web/app/maxxi/shell.tsx` | shell, nav, drawer, ruolo admin |
| `PageHeader` | `apps/web/app/maxxi/ui.tsx` | eyebrow + titolo + sottotitolo + azioni |
| `Card` | `ui.tsx` | bordo 1px, radius 4px, nessuna ombra |
| `SectionTitle` | `ui.tsx` | H2 + hint |
| `Kpi` | `ui.tsx` | variante `primary` per la prima riga |
| `Badge` | `ui.tsx` | testo + punto, colore solo di rinforzo |
| `DemoNote` | `ui.tsx` | nota metodologica a fondo card |
| Tabelle | classi `.maxxi-table` | header sticky, hover neutro, numeri a destra |
| Azioni | `.maxxi-primary-action` / `.maxxi-secondary-action` | min 44px, nero/bianco |
| Input | `.maxxi-input` | min 44px, focus blu utility |

## 6. Mappatura schermate

| Vista | Rotta | Interventi |
|---|---|---|
| Panoramica | `/maxxi` | hero tipografico, 4 KPI primari, 7 indicatori di contesto, line chart visite/mese, tabella fonti, revisione identità, percorsi demo |
| Visitatore 360 | `/maxxi/people?id=` | ricerca server-side per nome/email/ID; layout 8/4: timeline + provenienza a sinistra, myMAXXI/consensi/interessi/organizzazioni/qualità a destra, feedback a tutta larghezza; “Possibile duplicato” solo se il candidato corrisponde |
| Fonti | `/maxxi/sources` | tabella qualità con record, attribuite, non associabili, in revisione, ultimo import |
| Grafo relazioni | `/maxxi/graph` | grafo read-only di persone, organizzazioni, mostre, interessi e fonti; filtro per tipo, focus e dettaglio nodo |
| Segmenti | `/maxxi/segments` | due numeri (contattabili vs valutate), esclusioni raggruppate, tabella con motivo testuale, proposta e CTA dry-run |
| Campagne | `/maxxi/campaigns` | stepper 1–5, banner dry-run, bozze con “Dettaglio” (anteprima, destinatari, esclusioni, audit) e “Simula approvazione” |
| Assistente | `/maxxi/agent` | composer + risposte in due colonne, evidenze/ID, nessuna chat a pieno schermo |
| Accessi | `/maxxi/operators` | utenti Keycloak, ruoli, stato, form di creazione/modifica |

## 7. Deviazioni dichiarate

1. **Voci di navigazione**: la specifica elenca `myMAXXI`, `Mostre ed eventi`,
   `Infopoint e feedback`, `Sostenitori` come viste separate. In questa tranche
   non esistono rotte dedicate: i contenuti sono dentro Visitatore 360,
   Segmenti e Fonti. La sidebar mostra solo ciò che è realmente implementato,
   senza link finti.
2. **Fotografia**: nessun asset licenziato, quindi hero tipografico e nessuna
   immagine nelle card. Il registro asset lo dichiara.
3. **Grafico**: “Pubblico nel tempo” usa le visite effettive del fixture
   (ago–ott 2026), non una serie storica inventata. Con 3 mesi il line chart è
   volutamente minimale.
4. **Dark mode**: disabilitata nello scope, come ammesso dalla specifica.
5. **Font**: stack Inter + fallback di sistema; nessun download di font
   proprietari o non licenziati.
6. **Sostenitori**: la relazione organizzazione → persona è visibile nel profilo
   360; non esiste una vista donatori separata perché il fixture non contiene
   importi di donazione.

## 8. Accessibilità

- Skip link e landmark (`nav`, `main`, `header`).
- `aria-current="page"` sulla voce attiva; `aria-expanded`/`aria-controls` sul
  drawer; chiusura con Escape e ripristino del focus.
- Target interattivi ≥44px (nav, azioni, input, checkbox).
- Focus ring blu 2px con offset su tutto lo scope.
- Stato espresso con **testo** (`Contattabile`, `Consenso mancante`, `Identità
  incerta`) e colore solo come rinforzo.
- Grafico con `<title>`, `role="img"`, didascalia e tabella `sr-only` con i dati.
- `prefers-reduced-motion` disattiva transizioni e animazioni.
- Tabelle con `<caption>`, header `scope`, scroll orizzontale contenuto su
  mobile senza overflow del documento.

## 9. File toccati

- `apps/web/app/globals.css` — blocco `[data-workspace-theme="maxxi"]`.
- `apps/web/app/maxxi/layout.tsx` — usa `MaxxiShell`.
- `apps/web/app/maxxi/shell.tsx` — nuova shell.
- `apps/web/app/maxxi/ui.tsx` — primitive editoriali.
- `apps/web/app/maxxi/{page,people,sources,segments,campaigns,agent,operators}` — reskin.
- `apps/web/app/api/maxxi/overview/route.ts` + `lib/maxxi/queries.ts` —
  `activity` mensile dal dataset.
- `apps/web/app/maxxi/header.tsx` — rimosso (sostituito dalla shell).
