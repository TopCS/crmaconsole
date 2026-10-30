# MAXXI — Specifica UX/UI e Design System per CRM-A Console (CDP)

**Versione:** 1.0 — 28 ottobre 2026  
**Destinatario:** harness di sviluppo, product designer, frontend engineer  
**Repository target:** `https://github.com/TopCS/crmaconsole`  
**Contesto:** demo verticale `MAXXI Customer Intelligence` in un workspace isolato  
**Stato:** specifica *derivata* dai riferimenti pubblici e dalla lettura del codice; **non** brand book ufficiale approvato dal museo.

> **Obiettivo in una frase.** Adattare il linguaggio visivo di CRM-A Console alla personalità editoriale, contemporanea, essenziale e ad alto contrasto del MAXXI, conservando la leggibilità di una CDP operativa e mantenendo chiara la natura dimostrativa del progetto.

## 0. Modalità di utilizzo e priorità

Questo documento **integra** `02_MAXXI_DEMO_PRD.md` e `04_ACCEPTANCE_AND_DEMO_SCRIPT.md`. Non modifica le regole di sicurezza, consenso, sandbox o invio in dry-run. Implementare il tema dopo la definizione del workspace MAXXI e in parallelo alle viste verticali: NON rifare l'intera UI generica di CRM-A.

L'harness deve:
1. analizzare la UI reale in `apps/web/app/globals.css`, `apps/web/app/page.tsx`, `apps/web/app/components/`, inclusi `crm/`, `workspace/`, `ui/`;
2. costruire un tema **scoped**, abilitato solo nel workspace demo MAXXI;
3. riutilizzare componenti esistenti e token semantici, evitando override globali di `:root` e `.dark`;
4. produrre e verificare le schermate descritte qui sotto, con screenshot a viewport desktop e mobile;
5. consegnare token, componenti, matrice visual QA e lista puntuale di modifiche.

## 1. Fonti e grado di certezza

### 1.1 Riferimenti verificati

- **Sito istituzionale:** https://www.maxxi.art/ (consultato 28/10/2026). Navigazione editoriale `cosa accade`, `visita il MAXXI`, `collezione`, `sostienici`; immagini fotografiche, contenuti a tipologia (mostra, focus, evento), date e titoli ben evidenziati. Questa IA pubblica **non va copiata letteralmente** nella console.
- **Identità istituzionale spiegata dal museo:** https://www.maxxi.art/events/maxxi-una-finestra-sulla-contemporaneita/ . Il marchio contrappone la radice `MA` ispirata alle incisioni romane al suffisso `XXI` racchiuso in un frame variabile. Il logo è elemento proprietario, non una semplice combinazione testuale da ridisegnare.
- **Case study del designer dell'identità, Inarea:** https://inarea.com/en/case-study/maxxi-national-museum-of-21st-century-arts/ . Conferma contrasto tipografico, identità dinamica e frame `XXI` come finestra 16:9.
- **Case study del sito, Studio Amaranto:** https://www.amarantoweb.com/works/museo-maxxi/ . Descrive layout minimale, plastico, navigazione intuitiva e valorizzazione delle immagini; è descrizione del concept storico e **non** un export dei CSS attuali.
- **Guida MAXXI 2018–2019, Bunker:** https://www.bnkr.it/en/portfolio/progetti/guidebook-maxxi-museum . Riporta **Maison** come corporate font per titoli e descrizioni e **Miller** per corpo di quel volume; questa NON è prova che siano i font web correnti né autorizzazione a distribuirli.
- **Brief cliente allegato:** `sources/CRM_brief_MAXXI(1).pdf` pp. 1–2 e 9–11. Esempi di blocchi neri/bianchi e fotografia architettonica; sono esempi di comunicazione del 2024, non indicazioni obbligatorie per un backoffice.

### 1.2 Cosa è una proposta, non un fatto di brand

I valori HEX, dimensioni, raggi, spaziature, font di fallback e layout di questo documento sono **token proposti per la demo**, non colori/font ufficiali estratti e approvati dal MAXXI. Prima dell'uso in produzione, sottoporli al referente comunicazione e chiedere eventuali brand guidelines, logo e asset con autorizzazione.

## 2. Direzione creativa — "MAXXI editoriale, non dashboard SaaS generica"

**Principi:**

- **Bianco/nero come struttura:** superfici chiare e testo quasi nero; il nero viene usato per navigation, intestazioni selettive, CTA primarie e delimitatori gerarchici. Le opere e le mostre forniscono il colore visivo, non la chrome dell'applicazione.
- **Tipografia protagonista:** titoli grandi e decisi, etichette piccole e precise, spazio bianco, ritmi verticali riconoscibili. Evitare gradienti AI, bagliori neon e decorazioni decorative.
- **Fotografia come contenuto:** singola fotografia di architettura o di un'esposizione nella pagina d'apertura, thumbnails nelle schede mostra/evento; NON foto nei grafici KPI, tabelle, schermate di consenso o anagrafiche.
- **Un accento editoriale, non una campagna:** se un'esposizione ha un colore nel materiale autorizzato, usarlo nella sua card, non ridefinire tutta la UI.
- **Rigore dei dati:** numeri in chiaro, etichette comprensibili, separazione fra `visite`, `biglietti`, `persone note`, `anonimi`, `consensi` e `campagne simulate`.
- **Identità discreta, mai fuorviante:** la UI deve mostrare che è una *demo tecnologica non ufficiale* realizzata per un colloquio commerciale; non apparire come un portale del museo già in produzione.

### 2.1 Moodboard in parole

`editoriale / istituzionale / contemporaneo / grafico / monocromatico / architettura / tipografia / whitespace / griglia razionale / fotografia curata`.

**Non:** `gradienti viola/blu / UI giocosa / pill decorative ovunque / glassmorphism / 3D gratuito / bot antropomorfo / skeleton scintillanti / luci colorate a caso`.

## 3. Design tokens proposti (light-first)

La demo adotta tema chiaro di default. Il tema scuro è opzionale: se non è implementato, nel workspace MAXXI si deve disabilitare il toggle anziché mostrare una UI incoerente. Il file `ui/maxxi-theme.reference.css` contiene uno scheletro CSS **non automaticamente pronto al merge**.

| Categoria | Token | Valore proposto | Uso |
|---|---|---|---|
| Colore | `--maxxi-ink` | `#111111` | testi, CTA primaria |
| Colore | `--maxxi-black` | `#080808` | sidebar, bande editoriali |
| Colore | `--maxxi-paper` | `#FFFFFF` | canvas e card |
| Colore | `--maxxi-canvas` | `#F6F6F4` | sfondo esterno e superfici tenui |
| Colore | `--maxxi-line` | `#D7D7D4` | bordi, tabelle, separatori |
| Colore | `--maxxi-muted` | `#555553` | testo secondario, WCAG da testare |
| Colore | `--maxxi-selected` | `#EAEAE7` | hover e selezione chiara |
| Colore | `--maxxi-focus` | `#165CC4` | focus visibile accessibile, **utility**, non colore del brand |
| Semantico | successo | `#236545` | conferma, dati validati |
| Semantico | attenzione | `#9B5A0C` | revisione identità, consensi dubbi |
| Semantico | errore | `#A53232` | errori bloccanti |
| Tipografia | display | `Inter, Helvetica Neue, Arial, sans-serif` | titoli UI, fallback implementabile |
| Tipografia | body | `Inter, system-ui, sans-serif` | contenuti e tabelle |
| Tipografia | numeri | `font-variant-numeric: tabular-nums` | KPI, tabella, contatori |
| Raggi | `--maxxi-radius` | `4px` | card, input, dialog (evitare rounded-2xl) |
| Ritmo | unità | `4px` | spacing 4 / 8 / 12 / 16 / 24 / 32 / 48 |
| Shadow | base | minima / nessuna | preferire border 1px e gerarchia tipografica |

**Logo e font:** se il cliente concede il logo ufficiale e i font, integrarli tramite asset locali approvati e un wrapper configurabile. NON scaricare font proprietari né replicare a mano il marchio `MA XXI` (soprattutto il frame dinamico). Altrimenti usare un wordmark neutro `MAXXI · DEMO` *tipografico*, ben distinto dal logo ufficiale.

### 3.1 Scala tipografica suggerita

| Ruolo | Desktop | Mobile | Peso | Interlinea |
|---|---:|---:|---:|---:|
| Page display | 38–44px | 28–32px | 650–750 | 1.05–1.15 |
| H1 di sezione | 28–32px | 24–26px | 650–700 | 1.15 |
| H2 / blocco | 20–24px | 19–22px | 600–700 | 1.25 |
| H3 / card | 16–18px | 16–18px | 600 | 1.3 |
| Body | 14–15px | 14–15px | 400 | 1.45–1.6 |
| Label tabella | 12–13px | 12–13px | 600 | 1.4 |
| Caption / source | 12px | 12px | 400–500 | 1.35 |
| KPI value | 30–36px | 26–30px | 600–750 | 1.1 |

Il body non deve scendere sotto 14px per contenuti importanti, tabelle o strumenti di lavoro. Le micro-etichette di 12px sono ammissibili solo come supporto non essenziale.

## 4. Shell applicativa MAXXI

### 4.1 Desktop (viewport di riferimento 1440×900)

- **Top bar:** altezza indicativa 64px; titolo `MAXXI / Customer Intelligence`, breadcrumb, selettore workspace, ricerca, azioni account. Badge visibile `DEMO · DATI SINTETICI` e, in campagne, `NESSUN INVIO ESTERNO`.
- **Sidebar:** fascia nera `#080808`, larghezza 236–256px, testo bianco; separatori sottili e gruppo di sezioni organizzato per compito. La voce attiva ha barra bianca e sfondo grigio scuro, non un accento blu ereditato dalla UI generica.
- **Content area:** background `#FFFFFF` o canvas `#F6F6F4` con pannelli bianchi; max content width consigliata 1360px; griglia 12 colonne (gap 24px) per dashboard, griglia 8/4 per profili.
- **Header sezione:** sovratitolo (es. `IL PUBBLICO`), titolo grande, sottotitolo/contesto, CTA discreta. Separatore orizzontale da 1px; whitespace generoso sopra e sotto.
- **Right panel agente:** pannello contestuale da 340–420px, su richiesta, col titolo `Assistente MAXXI` e segnalazione di fonti e stato dei tool; NON sostituire i contenuti primari della CDP con una chat a pieno schermo.

### 4.2 Mobile/tablet

- Tablet: sidebar collassabile, contenuto 8 colonne, agente in drawer.
- Mobile 375×812: nav tramite drawer, niente overflow orizzontale del documento; KPI in colonna 1/2, tabelle con scroll contenuto e intestazioni leggibili, non rimpicciolite; panel profilo a schede (`Panoramica`, `Timeline`, `Consensi`, `Membership`).
- Target touch min 44×44px; CTA e filtri navigabili da tastiera.

### 4.3 Nomenclatura di navigazione (italiano)

La navbar *non copia* `cosa accade / visita il MAXXI` del sito pubblico. Usa le attività operative del museo:

| Gruppo | Voce in UI | Vista PRD |
|---|---|---|
| INTELLIGENCE | Panoramica | KPI, trend, data quality |
| PUBBLICO | Visitatori | profilo 360, timeline |
| PUBBLICO | Fonti dati | ingestion / riconciliazione |
| PUBBLICO | Segmenti | condizioni e membership |
| RELAZIONE | myMAXXI | card, rinnovi, scadenze |
| RELAZIONE | Mostre ed eventi | catalogo e registrazioni |
| RELAZIONE | Infopoint e feedback | richieste e follow-up |
| ATTIVAZIONE | Campagne | bozze e dry-run |
| ISTITUZIONALE | Sostenitori | donors / aziende sponsor |

La navigazione originale CRM-A per chat, skills, file e impostazioni deve rimanere accessibile (es. sezione `Strumenti` o menu utility), senza alterare altri workspace.

## 5. Componenti e pattern

### 5.1 Componenti globali

- **Editorial section header:** eyebrow uppercase (letterspacing 0.10–0.14em), titolo bold, breve frase descrittiva; linea orizzontale opzionale.
- **KPI block:** valore grande tabulare, label una riga, hint `dal dataset demo` o periodo, eventuale delta soltanto se calcolato; niente icone colorate puramente decorative.
- **Card:** superficie bianca, bordo sottile, radius 4px, senza glow; dimensione e layout coerenti.
- **Tabs:** sottolineatura nera 2px sul selezionato, non pill arrotondate.
- **Search & filter:** search compatta, filtri testuali, chip neutri selezionabili; contatori espliciti.
- **Table:** header sticky, bordi sotto riga, altezza riga 44–52px, hover neutro, allineamento dei numeri a destra, nomi a sinistra, empty state informativo; selezione accessibile.
- **Source label:** icona fonte + nome + `record_id` abbreviato + data acquisizione; clic per aprire la prova.
- **Status indicator:** testo prima del colore (`Attivo`, `Scade entro 45 gg`, `Revocato`, `Da verificare`, `Anonimo`). Colori semantici solo come rinforzo.
- **Consent control:** mostra per `finalità × canale × stato × data × provenienza`; mai un booleano generico come unico segnale.
- **Agent panel:** domande suggerite orientate al lavoro, risposta con footnotes/ID fonte, CTA `Prepara bozza` e conferma esplicita prima di azioni simulate.
- **Banner demo:** visibile in tutte le viste e durante lo scroll; semplice monocromatico, **non scambiabile** per un errore di sistema.

### 5.2 UI states obbligatori

Loading con skeleton neutro e testo di contesto; empty `Nessuna informazione disponibile`; error con descrizione recuperabile; incomplete data `Fonte non collegata`; imported/mock `Fonte simulata`; ambiguous identity `Richiede revisione`; AI without evidence `Non ho evidenze sufficienti`; no consent `Non contattabile per questa finalità`.

## 6. Specifica schermate: wireframe descrittivo

### 6.1 A — Panoramica (opening slide operativo)

- Sopratitolo `INTELLIGENCE / PANORAMICA`.
- Titolo `Conoscere il pubblico. Comprendere le relazioni.`
- Sottotitolo `Dati dimostrativi integrati da più sistemi, con fonti e qualità verificabili.`
- Facoltativa immagine architettonica autorizzata in hero **contenuta** (max 20–25% dell'area above the fold). Senza asset licenziato, hero monocromatica tipografica.
- Prima riga: quattro KPI derivati da fixture: `Persone identificate`, `Visite attribuite`, `Membership in scadenza`, `Casi da revisionare`.
- Seconda riga: `Fonti di acquisizione` (tabella stati) e `Pubblico nel tempo` (line chart con data window).
- Terza riga: scorciatoie a `Profili 360`, `Segmenti`, `Campagne`.
- Regola: niente cifra `170.000` come valore realtime della demo; è dato storico del brief 2024 e può apparire solo in una nota esplicitamente datata.

### 6.2 B — Visitatore 360

Layout 8/4: colonna principale con nome, identità, badge `Identificato/Non verificato`, timeline cronologica `Evento → Fonte → Riferimento`, collegamenti `Biglietto`, `Visita`, `Form`, `Biblioteca`, `Infopoint`. Colonna destra con scheda myMAXXI, interessi dichiarati/derivati distinti, consensi, eventuale segnalazione `Possibile duplicato`. Drawer `Perché questi record sono collegati?` con match rule e riferimenti originali. L'assistente apre il contesto del visitatore senza caricare informazioni di altri record.

### 6.3 C — Fonti e qualità

Tabella sorgenti: `Sito/Form`, `Archeoares (XLS simulato)`, `myMAXXI`, `Biblioteca`, `Infopoint`. Colonne `Stato`, `Record`, `Identificati`, `Non associabili`, `In revisione`, `Ultimo import`. Evidenziare i non associabili senza usare rosso come errore: **anonimo non significa errore**. Pannello di revisione merge con confronto a due colonne e prova del motivo del suggerimento; default nessun merge automatico su nome soltanto.

### 6.4 D — Segmenti

Segment builder con righe di condizioni, linguaggio naturale di supporto e query/calcolo deterministico sotto. Due numeri ben separati: `Visitatori che soddisfano i criteri` vs `Contattabili via email per questa finalità`. Elenco esclusi con motivo (`Opt-out`, `Consenso non noto`, `Email non valida`, `Identità incerta`). Un pulsante `Chiedi all'assistente` porta il segmento al panel agente.

### 6.5 E — myMAXXI e mostre

Vista membership chiara e tabellare, con stati `Attiva`, `In scadenza`, `Scaduta`, `Non associata`; importo e date soltanto se presenti nelle fixture. Catalogo mostre con **foto autorizzate** in card e categorie + periodo; nel PRD usare `Vitalità dell’architettura italiana 1946–2026` e `Sophie Calle — Matrimoni, Rotture e Funerali inclusi` senza inventare presenze.

### 6.6 F — Campagne in dry-run

Layout a step: `1 Segmento` → `2 Proposta AI` → `3 Verifica consenso` → `4 Anteprima` → `5 Simula approvazione`. Testo persistente `Modalità dimostrativa: nessuna comunicazione sarà inviata`. CTA primaria nera `Salva bozza`; CTA di simulazione secondaria bordo nero; nessuna CTA `Invia ora` attiva in demo. Preview email con template editoriale sobrio che usa i contenuti espositivi autorizzati, senza fingere che l'email sia già stata inviata dal MAXXI.

### 6.7 G — Infopoint e sostenitori

Tabella richieste con priorità/stato/tempo, scheda feedback; azione agente `Prepara un riepilogo` (non rispondere senza conferma). Sostenitori: relazione organizzazione → referente → proposta/contatto; separare nettamente donazione da acquisto e membership.

## 7. Design delle visualizzazioni dati

- Grafici con uno/due toni neutri, asse etichettato e unità; usare accenti cromatici solo se esprimono un *significato* come criticità o categoria distinta. Nessun 3D e nessuna texture.
- Per `visite/ingressi` usare line chart; per fonti o tipologie usare barre; non usare pie chart con 10 categorie illeggibili.
- Ogni pannello riporta intervallo temporale e stato `Dati dimostrativi`.
- Tooltip con `numeratore`, `denominatore`, `definizione`, `fonte`, `periodo` (dove sensato).
- Non confondere `iscrizione evento` con `presenza verificata`, `ticket acquistato` con `ingresso`, `contatto interessato` con `donatore`.

## 8. Accessibilità e quality bar

- WCAG **2.2 AA** come target di progettazione; contrasto normale >=4.5:1 e UI non testuale >=3:1 dove richiesto; verificare i colori realmente resi, non assumere che i token bastino.
- Focus ring visibile con tastiera; menu drawer accessibile, etichette e aria-label, modali focus-trap e Escape.
- Icone non unico vettore di significato; non affidarsi al solo colore per consenso o criticità.
- Reduced motion: animazioni di transizione <=200 ms e `prefers-reduced-motion` rispettato; niente parallax sulla dashboard.
- Supportare zoom 200%, riduzione viewport, scrollbar tabelle.
- Form e ricerca con stati `hover/focus/error/disabled`, testo di errore esplicito.
- Non alterare l'accessibilità attuale per introdurre lo stile.

## 9. Implementazione mirata nella codebase

**File ispezionati (revisione repository consultata 28/10/2026):**

- `apps/web/app/globals.css` — già definisce `--color-bg`, `--color-surface`, `--color-sidebar-bg`, `--color-accent`, `--color-text` e `.dark`; NON sostituire le definizioni globali.
- `apps/web/app/components/sidebar.tsx` — usa CSS variables, ottimo candidato per tema scoped, ma controllare la sidebar effettivamente resa nell'app.
- `apps/web/app/components/crm/person-profile.tsx` e `crm/segments/` — elementi da adattare riutilizzando i componenti, non da clonare.
- `apps/web/app/components/ui/` e `apps/web/app/components/crm/` — bottoni, card, dialog, tabelle e timeline da reskin via token.
- `apps/web/app/page.tsx` — determinare l'attuale shell effettiva e l'assegnazione del workspace.

**Strategia di theming raccomandata:**

1. Introdurre un *workspace theme resolver* che restituisce `themeId = 'maxxi-demo'` SOLO per il workspace/flag MAXXI, default neutro altrove. Il flag deve provenire da stato validato server-side, non dal solo query parameter.
2. Annotare un wrapper superiore della UI con `data-workspace-theme="maxxi"`. Definire `--color-*` esistenti e nuovi `--maxxi-*` **sotto tale wrapper**, non in `:root`.
3. Creare componenti *skin-specific* piccoli (`MaxxiEditorialHeader`, `MaxxiDemoRibbon`, `MaxxiKpiBlock`, `MaxxiSourceTag`, `MaxxiStatusText`) che usino le logiche applicative esistenti.
4. Evitare di impostare `.dark` nel workspace MAXXI finché la modalità scura non è completa. Il tema light prevale sui token globali in modo deterministico.
5. Preservare menu e routing generic CRM-A, chat e skill, facendo emergere le voci MAXXI in una navigazione contestuale dedicata.
6. Non caricare font e immagini da CDN esterne non controllate; mantenere un registro di provenienza/licenza degli asset visuali nel repository.
7. Non modificare template email pubblici o altri workspace: override dei template **solo** nella demo MAXXI.

### 9.1 Esempio di scope, non codice di produzione definitivo

```tsx
// Nel layout cliente dopo validazione server-side del workspace attivo:
<div data-workspace-theme={themeId === 'maxxi-demo' ? 'maxxi' : undefined}>
  {children}
</div>
```

```css
[data-workspace-theme="maxxi"] {
  --color-bg: #F6F6F4;
  --color-main-bg: #FFFFFF;
  --color-sidebar-bg: #080808;
  --color-text: #111111;
  --color-text-secondary: #555553;
  --color-border: #D7D7D4;
  --color-accent: #111111;
  --color-accent-hover: #333333;
}
```

Questi valori sono indicativi: controllare inline styles, utility Tailwind che bypassano le variabili, chart palettes, portal e dialog che potrebbero essere montati fuori dal wrapper e quindi non ereditare lo scope. In particolare il black sidebar richiede testo/iconografia chiari: **non** limitarsi a cambiare `--color-sidebar-bg`.

## 10. Acceptance — test visuali e funzionali aggiuntivi

Ogni riga è **pass/fail** verificabile con screenshot e comportamento.

| ID | Test | Acceptance obbligatoria |
|---|---|---|
| UX-001 | Apri workspace MAXXI vs workspace standard | Tema MAXXI solo nel primo; nessuna regressione visiva nel secondo |
| UX-002 | Dashboard desktop 1440×900 | Titolo, 4 KPI, fonte dati e badge demo visibili senza sovrapposizioni; navigazione operativa chiara |
| UX-003 | Profilo 360 | Timeline, provenienza, membership, consensi distinguibili senza scorrimento orizzontale pagina |
| UX-004 | Segmenti / consensi | Non contattabile evidenziato con testo e motivo; non solo colore |
| UX-005 | Campagna demo | Dry-run visibile, `Salva bozza`/`Simula approvazione`; nessun vero invio attivabile dalla UI |
| UX-006 | Layout mobile 375×812 e tablet 768×1024 | Drawer, KPI, tabelle e modali senza overflow globale; touch target >=44px |
| UX-007 | Accessibilità | Navigazione tastiera/focus, contrasto, riduzione movimento, modali validi |
| UX-008 | Asset provenance | Ogni immagine/logo/font ha origine e diritto d'uso registrato oppure placeholder chiaramente segnalato |
| UX-009 | Data transparency | In ogni report `Dati dimostrativi`; non confondere visite/ticket, stime/osservazioni |
| UX-010 | Regressione tema dark | O dark MAXXI testato end-to-end oppure toggle dark disabilitato solo nella demo; temi standard intatti |

**Screenshot richiesti dall'harness:** panoramica desktop, profilo desktop, segmenti desktop, campagna desktop, schermata mobile; per ciascuno annotare viewport e data. Se impossibile generarli, descrivere il blocco in `DELIVERY_REPORT.md` senza dichiarare QA eseguita.

## 11. Output richiesti all'harness

- Implementazione theme/scoping e componenti visivi riusati.
- `docs/maxxi/UI_DESIGN_SYSTEM.md`: token finali, pattern reali, eventuali compromessi rispetto a questa spec.
- `docs/maxxi/UI_ASSET_REGISTER.md`: URI file locale, fonte, licenza/permesso, ruolo UI.
- `docs/maxxi/UI_QA.md`: tabella UX-001..UX-010 con esito e link screenshot.
- Screenshot desktop/tablet/mobile, se ambiente disponibile.
- Changelog dei componenti modificati e verifica che altri workspace non cambino.

## 12. Prompt appendibile all'harness

> Implementa il design MAXXI nel workspace demo CRM-A Console seguendo `05_MAXXI_UI_LOOK_AND_FEEL.md` e `ui/maxxi-theme.reference.css`. Non copiare il sito web; traduci la sua estetica editoriale e l'identità ad alto contrasto in un backoffice CDP. Usa tema scoped solo sul workspace MAXXI, mantieni la UI standard altrove, garantisci accessibilità e banner `DEMO · DATI SINTETICI`, usa solo asset autorizzati e non abilita alcun invio esterno. Completa i test UX-001..UX-010 e allega screenshot e report delle deviazioni.

---

**Nota sul perimetro:** questa specifica non certifica la conformità al brand book MAXXI, non concede uso di marchi/font/immagini e non modifica gli obblighi di trattamento dei dati della futura implementazione reale.
