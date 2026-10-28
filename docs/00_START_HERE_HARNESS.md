# MASTER PROMPT PER HARNESS - CRM-A Console / MAXXI Customer Intelligence

> Questo file e' il prompt di avvio. Le altre specifiche nello stesso pacchetto sono normative per il lavoro.
> Data di riferimento: 2026-10-28. Lingua di UI e demo: italiano.

## Ruolo e risultato atteso

Agisci come lead engineer / product engineer su `https://github.com/TopCS/crmaconsole` (branch predefinito `main`), fork evoluto di DenchClaw basato su OpenClaw.

Realizza **una demo verticale MAXXI funzionante** in CRM-A Console, mentre introduci le protezioni essenziali e i confini architetturali identificati nella review. Il cliente la chiama "CRM"; il prodotto tecnico e' una **CDP / Customer Intelligence Platform** con una console CRM e assistenti AI. Non fare un replatforming completo, non costruire un altro runtime agentico e non rimpiazzare OpenClaw.

Prima di scrivere codice LEGGI, nell'ordine:
1. `01_PLATFORM_EVOLUTION.md` - interventi tecnici e sicurezza.
2. `02_MAXXI_DEMO_PRD.md` - esperienza, flussi e criteri prodotto.
3. `03_MAXXI_DATA_CONTRACT.md` - dati, identita', consenso, fonti, semantica.
4. `04_ACCEPTANCE_AND_DEMO_SCRIPT.md` - prove di accettazione e copione.
5. `task_manifest.yaml` - dipendenze e workstream.
6. `fixtures/maxxi_demo_seed.json` - dati tutti fittizi e deterministici.

Riferimenti originali (forniti dal committente):
- `CRM_brief_MAXXI(1).pdf`, MAXXI Ufficio comunicazione, settembre 2024.
- `Fonti_Dati.docx.pdf`, ricognizione delle fonti.
- `MAXXI_Funzionalita_CRM_Sviluppo.md.pdf`, sintesi funzionalita' attuali e richieste.
- Sito ufficiale MAXXI: `https://www.maxxi.art/`, `https://www.maxxi.art/my-maxxi/`, `https://www.maxxi.art/membership/`.

## Principi non negoziabili

- **Proteggere i dati prima di esporre la demo**: zero endpoint che restituiscono CRM/memorie o accettano SQL generico senza policy e controllo di accesso. Nessuna esposizione pubblica per default.
- **No dati reali dei visitatori**: il seed e' interamente sintetico, con email `example.invalid`; nessun caricamento di esportazioni reali o segreti negli artifact.
- **No invii reali**: campagna solo in modalita' anteprima. Nel profilo demo, invio email, SMS, WhatsApp e telefonate devono restare disabilitati a livello server. Non basta nascondere un pulsante.
- **No false integrazioni**: simula in modo chiaramente indicato i report XLS e i sistemi terzi; non presentare l'integrazione con Archeoares, WordPress, biblioteca, Matomo o i fornitori di biglietteria come completata.
- **Identita' e consenso spiegabili**: deduplica conservativa, indicazione fonte/periodo, scopo del trattamento e possibilita' di verifica umana.
- **Non distruggere il comportamento esistente**: migrazioni add-only, seed idempotente, default demo disabilitata, UI generica invariata fuori dal contesto MAXXI.
- **Lavora per task piccoli verificabili**: nessun commit massivo, nessuna cancellazione delle cartelle workspace esistenti, no force-push, no chiavi nei log.

## Strategia di esecuzione

**G0 - Discovery e baseline**
- Identifica la revisione Git effettiva; crea un branch `feat/maxxi-cdp-demo` dalla revisione corrente (senza modificare `main`).
- Mappa route e loro auth, schema DuckDB, componenti UI, servizi CDP, skill OpenClaw, demo seed e suite test presenti.
- Avvia i check esistenti (`pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, build rilevante) se le dipendenze sono disponibili; registra gli errori preesistenti.
- Non assumere che un README sia una implementazione completa: leggi i moduli citati in `01_PLATFORM_EVOLUTION.md`.

**G1 - Security gate obbligatorio**
- Implementa authz default-deny per route che leggono/scrivono dati CRM/memoria/workspace, con eccezioni strettamente dichiarate per webhook e tracking.
- Disabilita o isola in modo robusto l'esecuzione HTTP di SQL arbitrario; in particolare valuta `/api/workspace/execute` e `/api/workspace/query`.
- Preserva l'operativita' interna di OpenClaw e dei processi di sincronizzazione mediante credenziali service-to-service e permessi circoscritti.
- Verifica che Docker e URL pubblici non espongano l'istanza senza autenticazione. Impedisci public funnel in demo salvo configurazione esplicita, protezioni e test.
- **Non procedere a una presentazione pubblica senza test G1 verdi.**

**G2 - MAXXI vertical / dataset e UX**
- Crea un *template di workspace* MAXXI sul modello delle migration/bootstrap presenti; non copiare l'intera app.
- Importa i fixture sintetici da `fixtures/maxxi_demo_seed.json` con adapter idempotente e provenance. Usa gli oggetti esistenti quando disponibili; aggiungi solo gli oggetti e campi mancanti.
- Aggiungi viste: Panoramica del pubblico; Profili 360; Segmenti; Membership; Mostre/eventi; Campagne (anteprima); Feedback/Infopoint; Sostenitori (lite).
- Mostra su ogni vista persistente un indicatore testuale "DATI DIMOSTRATIVI". Aggiungi una descrizione trasparente delle fonti simulate.

**G3 - Tre percorsi demo end-to-end**
1. Da fonti eterogenee al profilo 360, con deduplica e provenienza.
2. Segmento dinamico -> proposta AI -> campagna in anteprima -> conferma simulata, mai invio.
3. Rinnovo myMAXXI e relazione con visitatore / feedback infopoint; aggiungi una scheda sostenitore legata a un'organizzazione.

**G4 - API e interoperability, minimo utile alla demo**
- Pubblica un layer applicativo strutturato per leggere profili, timeline, segmenti, membership e fonti. Usa input validati, limit/pagination e authz.
- Definisci un semplice adapter/tool OpenClaw con endpoint read-only e un tool di **proposta** campagna senza side effect esterni; implementa un server MCP solo se non mette a rischio i gate precedenti. Documenta come estendere verso MCP completo.
- Non fare migrazione PostgreSQL in questa demo: definisci una boundary di repository/storage per poter introdurre PostgreSQL in un workstream futuro.

**G5 - Validazione e consegna**
- Test automatici (unit/integration/e2e dove possibile) per sicurezza, seed, identita', consenso, segmenti, campagne, KPI e percorso demo.
- Esegui lint, test e build; riporta esattamente cosa e' passato e cosa no, senza dichiarare test eseguiti se non lo sono.
- Fornisci README con bootstrap locale, account di test (credenziali impostate dall'operatore, non hardcoded), reset demo, runbook presentazione e screenshot se possibili.
- Alla fine scrivi una relazione `DELIVERY_REPORT.md`: file modificati, schema, checklist accettazione, test, eventuali blocker e prossimi task.

## Risultati minimi obbligatori per dichiarare la demo completa

A. Dal dashboard una persona fittizia si apre con timeline unificata e fonti visualizzate.
B. Una persona duplicata fra due fonti viene riconciliata con regole spiegabili, senza duplicare la scheda.
C. Un record ambiguo NON viene unito automaticamente e compare in revisione.
D. Il segment builder trova una audience deterministica; i contatti senza consenso email non entrano nell'audience marketing.
E. L'agente risponde a "Quali visitatori interessati all'architettura hanno la myMAXXI in scadenza?" con conteggi, prove e finestra temporale; se non ci sono dati risponde "non disponibile", non inventa.
F. Da segmento si produce la bozza di comunicazione legata a una mostra reale del programma pubblico MAXXI; un click di "invio" NON effettua mai una spedizione nella demo.
G. L'operatore vede lo storico delle azioni/approvazioni anche se simulate.
H. Le route di dati e SQL non sono disponibili a richieste non autenticate, con test automatici.
I. Nessun contatto reale, invio esterno o credenziale in repository o output di test.

## Decisioni e comportamento in caso di ambiguita'

- Dai priorita' alla demo verticale e ai gate di sicurezza rispetto a refactoring generalisti.
- Non aggiungere feature fittizie come se fossero servizi pronti; usa adapter mock dichiarati.
- Se una dipendenza esterna (Composio, CRM-A Cloud, SES, NLPearl, provider LLM) non e' configurabile in locale, sostituiscila con un deterministic fake **solo nel profilo demo**.
- Se manca un permesso o una fonte, segnala il gap nel delivery report ma completa i percorsi che funzionano in sandbox.
- Se un requisito e' in conflitto con il codice, scegli la soluzione piu' sicura e minimamente invasiva e documentala nella sezione Decision Log.

## Comandi di riferimento (adatta ai tool/OS disponibili)

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm --dir apps/web build
```

Non eseguire comandi distruttivi sui workspace esistenti. Mantieni lo stato della demo in un workspace isolato e resettabile.

## Risposta finale richiesta all'harness

Riporta in italiano:
1. Cosa e' implementato e realmente funzionante (con percorsi precisi nella UI).
2. Lista dei cambiamenti significativi e delle route interessate.
3. Come avviare la demo in locale e riprodurre i 3 percorsi.
4. Test eseguiti con esito, comandi e limitazioni.
5. Dove la demo usa mock e dati sintetici.
6. Vulnerabilita'/gap ancora aperti e blocchi alla produzione.
7. Task consigliati per il successivo sprint (API/MCP, memoria temporale, PostgreSQL multiutente), NON confusi con il deliverable demo.
