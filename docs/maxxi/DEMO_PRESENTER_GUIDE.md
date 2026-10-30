# Guida per il presentatore — Demo MAXXI Customer Intelligence

**Durata consigliata:** circa 18 minuti (15 per il nucleo, 2 per il grafo)**Pubblico:** comunicazione, membership, infopoint, relazioni istituzionali, direzione**Ambiente:** demo locale su dati sintetici, nessun invio esterno

> **Messaggio da mantenere per tutta la presentazione**
>
> Questa è una demo non ufficiale. Visitatori, interazioni e consensi sono
> sintetici; non stiamo consultando gli archivi del MAXXI. Il backend e le
> operazioni applicative sono reali, ma i contenuti sono inventati.

---

## Indice

1. [Preparazione](#1-preparazione)
2. [Apertura](#2-apertura)
3. [Panoramica](#3-panoramica)
4. [Ricerca e profilo visitatore](#4-ricerca-e-profilo-visitatore)
5. [Grafo delle relazioni](#5-grafo-delle-relazioni)
6. [Segmentazione](#6-segmentazione)
7. [Assistente: Verificato e Chat AI](#7-assistente-verificato-e-chat-ai)
8. [Bozza campagna](#8-bozza-campagna)
9. [Infopoint e ruoli](#9-infopoint-e-ruoli)
10. [Chiusura](#10-chiusura)
11. [Domande frequenti](#11-domande-frequenti)
12. [Problemi durante la demo](#12-problemi-durante-la-demo)
13. [Cosa non dire](#13-cosa-non-dire)

---

## 1. Preparazione

### 1.1 Avvio dello stack

Dalla root del repository:

```bash
docker compose up -d
docker compose ps
```

Devono risultare attivi:

| Container             | Ruolo                                        |
| --------------------- | -------------------------------------------- |
| `crm-a-console`     | console Next.js su `http://localhost:3100` |
| `crm-a-keycloak`    | autenticazione e ruoli                       |
| `crm-a-keycloak-db` | database di Keycloak                         |

### 1.2 Accesso

Aprire **http://localhost:3100**.

La console reindirizza alla login Keycloak con il tema CRM-A. Usare un account
demo:

| Account        | Ruolo          | Uso nella presentazione                   |
| -------------- | -------------- | ----------------------------------------- |
|                |                |                                           |
| `admin.demo` | Amministratore | percorso completo, seed, accessi          |
| `comm.demo`  | Comunicazione  | segmenti e campagne, senza note infopoint |
| `memb.demo`  | Membership     | profili e membership                      |
| `info.demo`  | Infopoint      | profili e note infopoint                  |
| `rel.demo`   | Relazioni      | organizzazioni, senza dati personali      |

La password demo predefinita è `demo-password-1`. È un valore di demo: non
usarlo in un ambiente condiviso o raggiungibile da persone non autorizzate.

### 1.3 Controlli prima dell’incontro

Verificare che:

- la **Panoramica** mostri 8 persone identificate, 6 visite attribuite,
  5 membership in scadenza e 1 caso da revisionare;
- la ricerca in **Visitatori** trovi `Maria Rossi` e `Giulia Bianchi`;
- **Segmenti** mostri 2 persone contattabili;
- **Campagne** contenga almeno una bozza apribile con **Dettaglio**;
- **Assistente** risponda in modalità **Verificato**;
- dal profilo di Maria, **Vedi relazioni** apra il grafo con il nodo Maria
  visibile;
- la barra **Percorso demo** (Profilo → Grafo → Segmento → Bozza) sia visibile
  e cliccabile;
- la modalità **Chat AI** produca una risposta oppure mostri chiaramente
  **Fallback verificato**.

Se manca il dataset:

1. accedere come `admin.demo`;
2. aprire **Panoramica**;
3. premere **Ricarica dati demo**.

> **Attenzione:** il seed ricostruisce il dataset demo e cancella anche bozze e
> audit. Non premerlo durante la presentazione se vuoi conservare contenuti già
> creati.

### 1.4 Se la Chat AI non risponde

La modalità Chat AI richiede un provider configurato e una chiave
`OPENROUTER_API_KEY`. Se il provider non è disponibile, la risposta passa
automaticamente al motore verificato.

Per la presentazione:

- usa **Verificato** come modalità principale;
- usa **Chat AI** solo dopo averla provata;
- se compare **Fallback verificato**, spiega che è il comportamento previsto:
  meglio una risposta verificata che un errore.

---

## 2. Apertura

**Tempo: 1 minuto**

### A schermo

Aprire **Panoramica** e lasciare visibile la banda superiore:

`DEMO · DATI SINTETICI · NESSUN INVIO ESTERNO`

### Cosa dire

> «Questa dimostrazione mostra come CRM-A possa evolvere da informazioni
> separate verso una vista più utile del pubblico: profili, interazioni,
> membership, consensi e relazioni.
>
> Il punto non è soltanto raccogliere più dati. È capire quali informazioni
> appartengono alla stessa persona, da dove arrivano e per quali attività
> possono essere utilizzate.
>
> L’ambiente è dimostrativo: le persone e le loro attività sono inventate. Le
> fonti sono simulate e non siamo collegati ai sistemi del museo.»

### Da chiarire subito

> «Il dato è sintetico, ma il percorso applicativo è reale: i dati sono
> caricati in un database dedicato, interrogati dalle API e usati per calcolare
> i risultati. Non è una sequenza di schermate statiche.»

---

## 3. Panoramica

**Tempo: 2 minuti**

### A schermo

Mostrare i quattro indicatori principali:

- **Persone identificate**
- **Visite attribuite**
- **Membership in scadenza**
- **Casi da revisionare**

Poi indicare il grafico **Pubblico nel tempo** e la tabella **Fonti di
acquisizione**.

### Cosa dire

> «La panoramica offre una prima lettura del pubblico e della qualità delle
> informazioni.
>
> È importante distinguere le persone dalle loro attività. Una persona può
> effettuare più interazioni; un biglietto acquistato non equivale
> necessariamente a una visita; un evento anonimo non deve essere attribuito
> automaticamente a qualcuno.»

Sul grafico:

> «Qui vediamo le visite attribuite presenti nel dataset della demo. Non è una
> serie storica reale del museo.»

Sulle fonti:

> «Ogni fonte dichiara il proprio stato e il numero di record trattati. In
> questa demo i connettori sono simulati: la schermata mostra come potrebbe
> essere governata la qualità del dato quando le integrazioni saranno
> disponibili.»

### Punto da evidenziare

> «Se non abbiamo elementi sufficienti per attribuire un record, è meglio
> lasciarlo separato che creare un collegamento sbagliato.»

---

## 4. Ricerca e profilo visitatore

**Tempo: 3 minuti**

### A schermo

1. Aprire **Visitatori**.
2. Cercare `Maria Rossi`.
3. Aprire il profilo.

La ricerca supporta **nome, email e identificativo persona**. È disponibile
anche nella barra superiore delle altre pagine MAXXI.

### Cosa dire

> «Partiamo da una persona e ricostruiamo il contesto disponibile:
> identificativi collegati, timeline, membership, consensi e interessi.
>
> L’obiettivo è evitare che ogni ufficio debba consultare informazioni
> frammentate senza sapere se parlano dello stesso visitatore.»

### Identità e provenienza

Nella sezione **Identità di origine**, mostrare le due fonti associate a Maria
e il dettaglio della regola di collegamento.

> «Per ogni collegamento mostriamo la fonte, il riferimento originale e la
> regola utilizzata. Questo permette di spiegare perché due record sono stati
> associati, invece di chiedere all’operatore di fidarsi di una fusione
> invisibile.»

### Timeline

Mostrare l’acquisto del biglietto e la visita effettiva.

> «La timeline conserva la natura dell’evento. Qui, per esempio, un acquisto è
> mostrato come acquisto: non lo trasformiamo automaticamente in una presenza
> effettiva.»

### Possibile duplicato

Nel profilo di Maria compare **Possibile duplicato**: il dataset contiene
un’altra Maria Rossi con un’identità distinta.

> «Questo non significa che le due persone siano state unite. Significa che
> esiste un record simile che merita attenzione. La decisione resta umana.»

Il collegamento porta alla coda in **Fonti dati**. Da **Confronta** si vedono
affiancati il record in revisione e i profili esistenti; un amministratore può
registrare **Mantieni separati** o **Unisci (simulato)** con una motivazione.
Anche “Unisci” non fonde nulla: la decisione è registrata e auditata, i profili
restano invariati. La somiglianza del nome è un indizio, **non una prova
sufficiente per unire i profili**.

### Consensi e membership

Indicare la card e il consenso email:

> «Nel profilo vediamo anche le condizioni che saranno rilevanti per una
> futura comunicazione: validità della membership e consenso per uno specifico
> scopo e canale.»

---

## 5. Grafo delle relazioni

**Tempo: 2 minuti**

### A schermo

1. Dal profilo di Maria premere **Vedi relazioni**.
2. Mostrare il grafo centrato su Maria: fonti collegate, interessi, mostre e
   il collegamento **Possibile duplicato**.
3. Cliccare un nodo, ad esempio `Vitalità dell’architettura…`, e mostrare il
   pannello di dettaglio.
4. Su un nodo persona, mostrare **Apri profilo 360**.
5. Se resta tempo, filtrare per tipo e usare **Mostra tutto**.

### Cosa dire

> «Il grafo rende visibili le connessioni che nel profilo restano distribuite
> tra sezioni diverse: da quali fonti arriva una persona, quali interessi ha,
> quali mostre ha visitato o acquistato, a quali organizzazioni è collegata.
>
> Il collegamento “Possibile duplicato” è un’indicazione di revisione: non è
> un’identità confermata e non viene conteggiato come tale. La coda completa
> resta in Fonti dati.
>
> Il grafo legge solo il database demo isolato e non espone le note private
> infopoint.»

### Cosa evidenziare

- Il grafo **non è un nuovo database**: è una proiezione relazionale read-only
  costruita sulle tabelle demo.
- Riusa il **canvas già presente in CRM-A**, ma con nodi, filtri e permessi
  MAXXI.
- I ruoli senza accesso ai profili, come Relazioni, non vedono il grafo delle
  persone.
- La prima apertura può richiedere qualche secondo; i dettagli successivi sono
  più rapidi grazie alla cache.

---

## 6. Segmentazione

**Tempo: 3 minuti**

### A schermo

Aprire **Segmenti**.

### Scenario

La demo considera persone che:

- hanno un interesse per l’architettura, esplicito o rilevato negli eventi del
  dataset;
- hanno una card myMAXXI in scadenza nella finestra di 45 giorni;
- hanno avuto un’interazione nell’ultimo anno;
- hanno un’identità sufficientemente verificata;
- hanno un consenso valido per email ed eventi/marketing.

### Cosa dire

> «Qui trasformiamo una domanda operativa in un segmento calcolato sui dati:
> chi potrebbe essere interessato a una comunicazione sul rinnovo della card e
> sulla programmazione legata all’architettura?
>
> Il risultato non è solo un elenco di nomi. Per ogni persona il sistema mostra
> se è inclusa o esclusa e il motivo.»

Indicare i due numeri:

- **Persone valutate:** l’insieme esaminato dal segmento;
- **Contattabili via email:** le persone che superano i criteri applicati.

Con il dataset iniziale:

> «Sono state valutate otto persone; due risultano eleggibili e contattabili.
> Le altre sono escluse per motivi espliciti, tra cui consenso non valido,
> identità incerta o condizioni non soddisfatte.»

### Consenso: esempio Giulia

Cercare nella lista **Giulia Bianchi** e mostrare l’esclusione per consenso non
valido o non noto.

> «Giulia può essere interessante dal punto di vista della membership, ma
> questo non basta per inserirla in una comunicazione marketing via email. Se
> il consenso non è valido o non è noto, la persona resta fuori.»

### Distinzione importante

> «Il segmento dimostra una regola specifica già implementata. Non stiamo
> ancora mostrando un builder generico con cui qualsiasi operatore può costruire
> liberamente ogni possibile segmento.»

### Proposta AI

Premere **Genera proposta AI**, mostrare il testo generato con fonti e modello,
modificarlo se serve e salvarlo come bozza.

> «La proposta usa solo dati verificati del segmento e del catalogo. Resta una
> bozza: l’operatore la rivede e decide se salvarla; nessun messaggio parte.»

---

## 7. Assistente: Verificato e Chat AI

**Tempo: 3 minuti**

### A schermo

Aprire **Assistente**.

La pagina offre due modalità:

1. **Verificato** — risposta deterministica, con dati ed evidenze;
2. **Chat AI** — risposta formulata da un modello usando i risultati dei tool
   disponibili.

### Prima domanda: modalità Verificato

Selezionare **Verificato** e chiedere:

> «Quali visitatori interessati all’architettura hanno una card myMAXXI in
> scadenza entro 45 giorni e consenso email?»

### Cosa dire

> «In modalità verificata l’assistente usa una logica deterministica.
> Restituisce il conteggio, la finestra temporale e i riferimenti disponibili,
> così il risultato può essere controllato.
>
> Questa modalità è utile anche se il modello AI non è disponibile.»

### Seconda domanda: Chat AI

Selezionare **Chat AI** e chiedere:

> «Quali fonti abbiamo e quanto sono affidabili?»

Mostrare la risposta, la riga **Tool usati** e le evidenze.

> «In questa modalità un modello linguistico rende la risposta più
> conversazionale. La chat ha a disposizione un insieme limitato di strumenti
> di lettura MAXXI; sotto la risposta possiamo vedere quali strumenti e fonti
> sono stati utilizzati.»

### Terza domanda: dato non disponibile

Chiedere:

> «Quanto hanno donato i sostenitori?»

> «Nel dataset non ci sono importi di donazione. La risposta corretta è quindi
> dichiarare che non ci sono evidenze sufficienti, non inventare una cifra.»

### Nota importante per il presentatore

La modalità Chat AI usa un provider esterno configurato: **le domande e i dati
sintetici necessari alla risposta possono essere inviati al provider**.

Se il provider non risponde, la UI può mostrare **Fallback verificato**.

Non promettere che l’AI non possa mai sbagliare:

> «Le evidenze aiutano a controllare la risposta; l’operatore deve comunque
> verificarla, soprattutto prima di prendere decisioni.»

**Non presentare questa fase come la chat OpenClaw completa:** la modalità
MAXXI attuale chiama direttamente il modello configurato e i suoi tool dedicati.
È un’integrazione ibrida, non ancora l’intera esperienza dell’agente generale
CRM-A.

---

## 8. Bozza campagna

**Tempo: 3 minuti**

### A schermo

1. Tornare su **Segmenti**.
2. Premere **Crea bozza (dry run)**.
3. Premere **Apri bozza**, oppure andare in **Campagne** e scegliere
   **Dettaglio**.

### Cosa dire

> «A partire dal segmento prepariamo una bozza di comunicazione. In questa demo
> il contenuto proposto è un testo predefinito; non va presentato come testo
> appena generato dall’AI.»

Nel pannello di dettaglio mostrare:

- oggetto e testo completo;
- segmento e finestra temporale;
- numero di destinatari eleggibili;
- esclusioni aggregate per motivo;
- stato della bozza;
- audit delle azioni.

> «Dry run non significa che la bozza scompare. La bozza viene salvata nel
> backend e può essere riaperta. Significa che il percorso non effettua
> l’invio.»

### Modifica, versioni e approvazione simulata

Mostrare **Modifica bozza**, cambiare l’oggetto e salvare una nuova versione;
poi aprire **Confronta versioni** e mostrare l’affiancamento. Infine premere
**Simula approvazione**.

> «La bozza è versionata: possiamo vedere cosa è cambiato e chi lo ha fatto.
> L’approvazione registra una snapshot di destinatari ed esclusioni e un’azione
> simulata nell’audit. Non produce un invio a email, SMS o telefono.»

### Precisazione sul pubblico

Il dettaglio ricalcola il segmento quando viene aperto: **non è uno snapshot
storico dei destinatari al momento della creazione**.

> «I numeri che vediamo sono il risultato corrente del segmento nella demo. Una
> fotografia storica dell’audience approvata è un’evoluzione da progettare.»

---

## 9. Infopoint e ruoli

**Tempo: 2 minuti**

### A schermo

1. Cercare **Giulia Bianchi**.
2. Aprire il profilo.
3. Mostrare la sezione **Infopoint e feedback**, se si è autenticati come
   amministratore o Infopoint.

### Cosa dire

> «La stessa persona può avere una storia di membership, visite e richieste
> all’infopoint. Il valore è mettere queste informazioni nel contesto giusto,
> senza rendere automaticamente tutto visibile a tutti.»

Se ci sono account predisposti, effettuare un confronto:

- come **Infopoint**, la nota del caso è visibile;
- come **Comunicazione**, il riepilogo della nota è mascherato.

### Come presentare Keycloak

> «Gli operatori accedono con account individuali gestiti da Keycloak. La
> console usa i ruoli per decidere quali funzioni mostrare e quali richieste
> autorizzare.»

### Limite da dichiarare

> «I controlli attuali sono una prima versione a grana grossa. L’autorizzazione
> per singolo record e le policy sui dati sono previste nella futura migrazione
> del database operativo a PostgreSQL. Non presentiamo la demo come un sistema
> già pronto per dati personali reali.»

---

## 10. Chiusura

**Tempo: 1 minuto**

### Cosa dire

> «Abbiamo visto un percorso completo: dalle fonti al profilo, dal profilo al
> segmento, dal segmento a una bozza verificabile.
>
> La parte importante non è solo la presenza dell’assistente AI: è il fatto che
> persone, fonti, consensi e azioni abbiano un contesto che l’operatore può
> esaminare.»

### Distinguere presente e roadmap

| Disponibile nella demo                    | Da approfondire prima di un uso reale                                      |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Database demo e API funzionanti           | Collegamento ai sistemi effettivi del museo                                |
| Profili sintetici, timeline e ricerca     | Formati, qualità e frequenza delle fonti reali                            |
| Segmento deterministico specifico         | Segmenti più flessibili e governati                                       |
| Assistente verificato e Chat AI           | Valutazione, governance e protezione dei dati                              |
| Bozze salvate e approvazione simulata     | Workflow operativo completo e snapshot dell’audience                      |
| Grafo relazioni read-only su dati demo    | Policy per record, autorizzazioni più fini e query in linguaggio naturale |
| Keycloak e controlli applicativi iniziali | Policy per record, PostgreSQL/RLS e sicurezza di produzione                |

### Domanda finale al cliente

> «Quale fonte sarebbe più utile collegare per prima per ottenere valore:
> biglietteria, myMAXXI, form online o infopoint?»

---

## 11. Domande frequenti

### «I dati sono reali?»

> «No. I dati sulle persone e sulle loro attività sono sintetici. Sono reali il
> backend e le operazioni applicative mostrate.»

### «Le mostre sono reali?»

> «Le due mostre citate provengono dal catalogo pubblico. Le presenze, gli
> interessi e le interazioni dei visitatori nella demo sono inventati.»

### «L’AI crea la campagna?»

> «L’assistente può interrogare e spiegare i dati. La bozza creata dal percorso
> Segmenti usa attualmente un testo predefinito: la generazione libera del
> contenuto è un’evoluzione distinta.»

### «Quando approvo, parte qualcosa?»

> «No. In questo percorso l’approvazione è simulata e viene registrata
> nell’audit. Prima di una presentazione va comunque verificato che la modalità
> demo sia attiva.»

### «Possiamo usare dati veri subito?»

> «No. Prima servono verifiche sulle integrazioni, sulla base giuridica, sui
> permessi, sulla protezione dei dati, sul deployment e sulla governance. La
> demo serve a validare il percorso e le priorità.»

### «Perché vedo un possibile duplicato?»

> «Perché esiste un record con elementi simili. È una segnalazione da
> verificare, non una fusione automatica e non una prova che si tratti della
> stessa persona.»

### «La chat può vedere tutti i dati?»

> «No. La chat usa solo i tool consentiti al ruolo dell’operatore. Per esempio,
> un ruolo Relazioni non riceve i profili personali. Le note private infopoint
> non sono incluse nei dati restituiti alla chat.»

### «Il grafo è un graph database?»

> «No. È una proiezione relazionale read-only sulle tabelle del database demo.
> Riusa il canvas grafico di CRM-A, ma non introduce un nuovo motore o una
> nuova sorgente dati.»

### «Perché un ruolo Relazioni non vede il grafo?»

> «Perché il grafo contiene nomi e relazioni delle persone. L’accesso richiede
> il permesso di lettura dei profili; senza quel permesso la pagina viene
> rediretta e l’API risponde 403.»

### «Il grafo unisce i duplicati?»

> «No. Mostra un arco “Possibile duplicato” come segnalazione da verificare.
> La fusione resta una decisione umana nella coda di revisione.»

### «La revisione identità modifica davvero i profili?»

> «No. La decisione è simulata: viene registrata con motivazione e audit, ma
> non fonde persone né cambia link o consensi.»

---

## 12. Problemi durante la demo

| Sintomo                                            | Cosa fare                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| La pagina non ha stile                             | Ricaricare con `Ctrl+Shift+R`; se persiste, verificare i log del container `crm-a-console`        |
| Login rifiutato                                    | Controllare le credenziali demo; se necessario, riallineare gli utenti nel realm Keycloak             |
| Dati assenti o vuoti                               | Accedere come admin e premere **Ricarica dati demo**                                            |
| `403` su **Ricarica dati demo**            | L’account non è admin: usare `admin.demo`                                                         |
| La Chat AI mostra **Fallback verificato**    | Il provider non è disponibile: continuare in modalità **Verificato**                          |
| La Chat AI non risponde affatto                    | Verificare chiave provider e connessione; usare **Verificato**                                  |
| La bozza non compare                               | Creare la bozza dal segmento; controllare che il segmento abbia eleggibili                            |
| Il dettaglio bozza è vuoto                        | La bozza potrebbe non esistere più dopo un seed: ricrearla                                           |
| Il grafo è vuoto                                  | Rimuovere i filtri o premere **Mostra tutto**; verificare che il ruolo abbia accesso ai profili |
| Il grafo resta su “Caricamento” per più di 10 s | Attendere la prima query; se persiste, controllare i log del container                                |
| Relazioni non vede il grafo                        | È il comportamento previsto: il ruolo non ha accesso ai profili personali                            |
| La console non risponde                            | `docker compose ps`, poi `docker compose logs --tail=100 crm-a-console`                           |

### Reset controllato prima della demo

Se si vuole ripartire da zero **prima** dell’incontro:

1. accedere come `admin.demo`;
2. aprire **Panoramica**;
3. premere **Ricarica dati demo**;
4. attendere il completamento;
5. verificare i quattro indicatori principali.

Non eseguire il reset a metà presentazione se hai già creato una bozza che
vuoi mostrare.

---

## 13. Cosa non dire

| Non dire                                               | Dire invece                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| «Questi sono i visitatori del MAXXI»                 | «Queste sono persone sintetiche che simulano il pubblico»                          |
| «L’AI ha generato la campagna»                      | «La demo prepara una bozza con un testo predefinito; l’AI assiste nell’analisi»  |
| «L’integrazione con la biglietteria è pronta»      | «Il connettore è simulato; l’integrazione reale è da progettare»                |
| «Approvando parte l’email»                          | «L’approvazione è simulata e finisce solo nell’audit»                           |
| «Il sistema è pronto per dati reali»                | «La demo valida il percorso; servono sicurezza, GDPR e integrazioni»               |
| «La chat conosce tutto il CRM»                       | «La chat usa solo i tool MAXXI consentiti al ruolo»                                |
| «I duplicati vengono uniti automaticamente»          | «I possibili duplicati vengono segnalati per una revisione umana»                  |
| «Il grafo è un graph database / una nuova sorgente» | «È una proiezione relazionale read-only del database demo»                        |
| «Il grafo unisce le persone collegate»               | «Mostra i collegamenti confermati e segnala i possibili duplicati, senza fonderli» |

---

## Riferimenti

- `docs/maxxi/DEMO_RUNBOOK.md` — avvio, reset e percorsi demo
- `docs/maxxi/SECURITY_GATE.md` — autenticazione, ruoli e limiti
- `docs/maxxi/CAMPAIGN_DRY_RUN.md` — bozze, dettaglio e prove di zero invii
- `docs/maxxi/GRAPH.md` — nodi, relazioni e permessi del grafo
- `docs/maxxi/AGENT_TOOLS.md` — modalità Verificato e Chat AI
- `docs/maxxi/UI_QA.md` — screenshot e verifiche visuali
