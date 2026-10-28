# PRD - demo verticale MAXXI Customer Intelligence (CDP)

**Stato:** specification per implementazione nell'harness. **UI design:** `05_MAXXI_UI_LOOK_AND_FEEL.md` e `ui/maxxi-theme.reference.css` (normativi per la demo). **Pubblico:** comunicazione, marketing, membership, relazioni, infopoint, direzione MAXXI. **Lingua:** italiano. **Branding:** usare un titolo dimostrativo `MAXXI Customer Intelligence - DEMO NON UFFICIALE` senza fingersi portale in produzione del museo.

## 1. Perche' la demo e' una CDP

Problema: il museo chiama CRM l'ambiente che deve governare anagrafiche, comunicazioni e relazioni, ma il valore richiesto e' l'unione di eventi e identificativi da sistemi eterogenei, la creazione di un profilo visitatore 360, l'analisi comportamentale e l'attivazione intelligente del pubblico.

Fonti documentali in `sources/`:
- `CRM_brief_MAXXI(1).pdf` (settembre 2024), pagine 2, 3, 9-11.
- `Fonti_Dati.docx.pdf` (ricognizione delle fonti).
- `MAXXI_Funzionalita_CRM_Sviluppo.md.pdf` (gap attuali/richiesti).

Requisiti comprovati: unificare dati, segmentare per eta'/interessi/frequenza, fidelizzazione, eventi/opening, feedback, reporting, membership, donatori e sponsor. Il brief del 2024 descrive circa 170k record nel CRM SaaS Aruba, non un numero attuale certificato. La biglietteria Archeoares esportava XLS quotidiani: la presenza del dato **non** prova che ogni biglietto sia associato a un individuo.

Sito ufficiale consultato il 2026-10-28: `https://www.maxxi.art/`, `/membership/`, `/events/categories/mostre/`. Il museo e' un'istituzione reale, ma **tutti i visitatori e le interazioni della demo sono inventati**. Mostre pubbliche da usare come voci di catalogo reali: `Vitalita' dell'architettura italiana 1946-2026` (29/05/2026-15/11/2026) e `Sophie Calle - Matrimoni, Rotture e Funerali inclusi` (16/10/2026-07/02/2027). Non inventare orari, opening o prenotazioni di questi eventi.

## 2. North star e promessa nella demo

**North star:** in meno di tre clic, l'operatore individua un visitatore, legge la sua timeline con le fonti e chiede all'agente una proposta d'azione motivata e autorizzabile.

Messaggio da comunicare: "Non un archivio di contatti: una conoscenza unica del pubblico, che collega comportamenti, membership, iniziative e relazioni, e rende l'AI utilizzabile in modo governato".

## 3. Utenti / ruoli simulati

- `Responsabile Comunicazione`: dashboard, segmenti, anteprima campagne, approvazioni.
- `Membership Manager`: scadenze card, rinnovi, tasso di riattivazione simulato.
- `Infopoint Operatore`: richieste e feedback, lettura minima del profilo.
- `Relazioni istituzionali`: organizzazioni, sponsor e donatori (solo demo fittizia).

L'RBAC granulare e' target successivo. Per questa demo si usa **un solo principal operatore protetto** e si presenta il diverso perimetro dei ruoli in UI solo quando realmente applicato; non fingere che un mock di RBAC sia enforcement.

## 4. Navigation / viste indispensabili

1. **Panoramica del pubblico:** persone note, identita' anonime, fonti, eventi, membership in scadenza, trend (tutti numeri DEMO). Ogni KPI deve essere calcolato dal dataset, mai hardcoded.
2. **Visitatori / Profilo 360:** persona, canali, opt-in per canale/finalita', membership, interessi espliciti/osservati (diversi), eventi, acquisti, visita, biblioteca, feedback, contatti e cronologia delle fonti.
3. **Fonti e qualita' dati:** pannello XLS Archeoares mock, form web mock, myMAXXI mock, biblioteca mock, infopoint mock; linee di provenienza, righe importate, scartate, non attribuibili e da revisionare.
4. **Segmenti dinamici:** segmenti salvati, condizioni, dimensioni, membership dettagliata e motivazione per ogni inclusione/esclusione.
5. **Membership myMAXXI:** stato, inizio/fine validita', benefici non inventati, rinnovi in scadenza, card non associata a persona; niente emissione reale di tessere.
6. **Mostre ed eventi:** catalogo dei due esempi reali, registrazioni e presenze inventate; una timeline distinta fra interesse, prenotazione e visita effettiva.
7. **Campagne:** compositore guidato dall'AI, conteggio destinatari eleggibili, bozza personalizzata, audit, DRY RUN permanente; nessun invio.
8. **Infopoint & feedback:** richieste, tipologia, stato, follow-up, analisi aggregata; dati simulati.
9. **Sostenitori:** persone/organizzazioni, contributi fittizi, incontri, impegni e prossime azioni, senza cifra inventata etichettata come dato reale del MAXXI.

## 5. Tre flussi di demo, tutti navigabili

### Scenario 1 - dal frammento alla persona

Input: tre rappresentazioni della persona sintetica `Maria Rossi`: form sito, registrazione myMAXXI e biglietto associabile a una card. Una variante con nome simile e email differente deve rimanere un candidato ambiguo, NON fuso.

- Nel pannello fonti mostra gli identificativi originari e la data import.
- Nel profilo 360 visualizza identita' canonica, identificativi di origine e timeline.
- Mostra che un ticket **anonimo** non viene falsamente attribuito a Maria.
- Spiega quali campi derivano da quale sistema e quale sia la regola di merge applicata.

Successo: una sola persona canonica per i match forti, zero falsi positivi sugli omonimi, provenienza visibile.

### Scenario 2 - intelligence, segmentazione e proposta

Domanda all'agente: `Quali visitatori interessati all'architettura hanno una card myMAXXI in scadenza nei prossimi 45 giorni, hanno interagito negli ultimi 12 mesi e hanno consenso valido per newsletter?`

- L'agente usa l'elenco deterministico membri del segmento e motivazioni verificabili.
- L'UI espone `conteggio eleggibili`, `esclusi per consenso`, `esclusi per identita' incerta`, `esclusi per dato mancante`.
- Bozza invito/rinnovo riferita alla mostra pubblica `Vitalita' dell'architettura italiana 1946-2026` (validita' fino al 15/11/2026). Se un destinatario non ha consenso email, non inviare neppure in simulazione all'audience eleggibile.
- Clic su `Simula approvazione`: traccia un'azione e una preview. `Invia` (se presente) non puo' chiamare SES/SMTP o canali OpenClaw.
- Report di stima (non di conversione): numeri derivati dal seed; niente risultati di campagna inventati come se fossero osservati.

Successo: query riproducibile, segmenti spiegabili, campagna creata come bozza, 0 messaggi esterni.

### Scenario 3 - membership, feedback e follow-up umano

- Apri `Giulia Bianchi` (profilo fittizio) con visita, feedback infopoint e card in scadenza.
- L'agente riassume il contesto e propone un follow-up all'operatore, indicando fonti ed elementi incerti.
- L'operatore decide di accettare/rifiutare la proposta; l'audit registra la scelta senza attivare un canale reale.
- Mostra un'organizzazione sostenitrice fittizia collegata a un contatto umano, evitando di confondere sponsorizzazione, membership e semplice acquisto biglietto.

Successo: CTA e workflow simulati, contesto coerente, nessuna inferenza ingiustificata.

## 6. UX e copy

- Interfaccia editorialmente affine al sito MAXXI: bianco/nero, grande gerarchia tipografica, card sobrie, fotografia contestuale; dettagli e test in `05_MAXXI_UI_LOOK_AND_FEEL.md`. Non riprodurre logo o font proprietari senza permesso.
- Indicatore persistente in header: `DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO`.
- In ogni grafico: `Dati dimostrativi generati, non statistiche del MAXXI`.
- Nelle fonti: distinguere `fonte descritta dal museo`, `connettore demo simulato`, `integrazione reale non verificata`.
- Nell'assistente: mostrare citazioni degli ID interni degli eventi e la fascia temporale; se assente la fonte, `Non ho evidenze sufficienti`.
- Esposizione demo in locale; nessuna login fittizia che mascheri un endpoint aperto.

## 7. KPI corretti per la verticale museale

Da calcolare con query affidabili, con definizioni chiare:
- Visitatori identificati (persone univoche; **non** accessi e **non** ticket anonimi).
- Visite attribuibili (solo eventi con identity link verificato).
- Eventi di partecipazione registrata vs effettiva presenza.
- Membership attive/in scadenza/scadute e rinnovi, con periodo.
- Recency (ultimo evento osservato), Frequency (numero di visite attribuite in finestra), Monetary solo da importo realmente presente nel fixture (non inventare costo ticket).
- Engagement score con composizione, peso e decay spiegati; non presentarlo come misura oggettiva di propensione.
- Consensi attivi per scopo/canale, bounce e opt-out.
- Feedback aperti/risolti e tempo alla risposta (solo se nel fixture ci sono i timestamp).
- Donor pipeline separata dalla normale membership.

## 8. Out-of-scope e de-risking

Nella demo NON si implementano: biglietteria reale, integrazione Aruba, import dei 170k record, generazione credenziali myMAXXI, sistema completo di eventi e posti, richieste di pagamento, email reali, mobile app, sensori sale, Wi-Fi visitor tracking, AI predictive dashboard, arricchimento social automatico, valutazione psicografica o inferenza di dati sensibili.

## 9. Accettazione business

- Durante la presentazione si puo' rispondere, con dati visibili, a `Chi e' questa persona?`, `Da quali sistemi viene?`, `Quali eventi possiamo usare per segmentare?`, `Quali visitatori possiamo contattare lecitamente?`, `Quale proposta suggerisce l'agente e perche'?`.
- Se si disconnette l'LLM, i profili, segmenti e KPI rimangono funzionanti e l'azione suggerita puo' essere presentata da una risposta deterministica identificata come fallback demo.
- Le viste non contengono statistiche hardcoded in contrasto con fixture e query.
