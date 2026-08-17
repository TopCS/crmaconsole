# Script Presentatore — Demo "Rome Future Week" (Crm-A Console)

> Percorso consolidato della demo, beat per beat. Durata indicativa: **~28–30 min**.
> Tono: vendita/educazione, ritmo **"touchpoint → record → campagna → chiamata vera → riconoscimento"**.
>
> **Niente CURL sul palco.** Ogni azione è una di queste tre cose:
> 1. un **comando in chat** all'agente (Copilot);
> 2. un **click in console / Shopify** (profilo, scheda campagna, checkout, dashboard NLPearl);
> 3. una **chiamata telefonica vera** (NLPearl fa l'AI della conversazione, la Console è il cervello CRM: riconosce, registra, orchestra).
>
> I `curl` esistono solo come verifica tecnica **in preparazione** (sezione "Checklist pre-demo" + `scripts/shopify-demo-simulate.sh`), mai durante la demo.
>
> **Premessa narrativa:** nessun contatto è pre-seeded. La demo parte **vuota**: il primo record
> nasce dal vivo, da un acquisto sull'e-commerce. Il touchpoint crea il cliente; da lì il CRM ricorda.

---

## 0. Apertura & setup (2 min) — "Da un touchpoint nasce un cliente"

**🎬 Scena:** due tab affiancati: la Console (chat Copilot pronta) e lo **Shopify dev store**
(`crm-a-demo-store`). Telefono del presentatore in vivavoce. Dashboard NLPearl in un altro tab.

**🖥️ Azione (solo prep, NON mostrata):** seed eseguito per **catalogo + segmento** (SAM-S26, SAM-S27, SAM-S25, segmento "Lancio Samsung Galaxy"); poi **rimuovere il contatto "Lorenzo"** del seed (chat: "Rimuovi il contatto Lorenzo" — o via UI) così il primo record nasce dal vivo in Atto 0; webhook Shopify configurato (`SHOPIFY_API_SECRET`); funnel attivo.

**Mostra in console:** **Integrations → card NLPearl** e **card Shopify** (URL webhook). Poi:
> *(Mostra la card Shopify.)* "Questo è il punto di ingresso: l'e-commerce. Quando qualcuno compra
> nel nostro store, un webhook arriva qui — e il CRM costruisce il profilo da zero. Nessun record
> esiste ancora. Vediamo cosa succede al primo acquisto."

**👀 Pubblico vede:** Integrations con card NLPearl + shopify (webhook URL); nel DB **nessun profilo "Lorenzo"** pronto (vedi prep).

---

## ⭐ Atto 0 — Un acquisto crea il record (5 min) *(da qui il CRM ricorda)*

**Obiettivo:** dimostrare che **da un touchpoint nasce un cliente**: nessun contatto pre-caricato.

**🖥️ Azione (live in Shopify):**
1. In Shopify il presentatore completa il checkout **come cliente "Lorenzo"** (email
   `lorenzo@example.com`, telefono = il proprio numero) e paga il **Samsung Galaxy S26**
   (SKU `SAM-S26`).
2. Il webhook `orders/create` arriva alla Console → l'agente **crea il profilo** e registra l'ordine.
3. *(Beat memoria)* il presentatore segna l'ordine **evaso** in Shopify (corriere GLS, in transito)
   → webhook `order/fulfilled` → l'ordine riceve corriere + stato di consegna.
4. In console mostrare il **profilo appena creato** (nome, email, telefono) con la timeline:
   interazione `Purchase` + ordine S26.

**🎙️ Script:**
> "Guardate: il CRM era vuoto. Ora qualcuno acquista il Galaxy S26 — ed ecco cosa succede: il
> webhook confronta i campi — email, telefono, nome — non c'è nessuno, quindi **crea la nuova
> anagrafica**, registra l'evento `Purchase` e materializza l'ordine. Un secondo, e quello che era
> un checkout è un cliente con la sua storia. Poi segno la spedizione in Shopify: il webhook
> aggiorna corriere e consegna. **Questo è il punto: da un touchpoint nasce un record, e da qui il
> CRM ricorda.**"
>
> *(Abilitazione al consenso — il webhook porta SOLO l'identità, mai il consenso.)* "Nota: il
> traffico e-commerce ci ha dato solo i dati anagrafici. Il consenso al marketing lo decide
> l'operatore. In chat: 'Abilita Lorenzo alla campagna telefonica: consenso marketing sì, canale
> preferito telefono.' L'essere umano resta nel loop."

**👀 Pubblico vede:** checkout in Shopify → in Console il profilo "Lorenzo" creato al volo (matched: created), timeline con `Purchase` + ordine S26 (GLS in transito); il comando di abilitazione al consenso in chat.

---

## Atto 1 — La campagna nasce dalla chat (5 min) *(il motore della demo)*

**Obiettivo:** mostrare il tool `crm_a_phone_campaign`: l'agente crea la scheda, pilota NLPearl e chiede conferma prima di ogni invio. Di qui parte la chiamata vera dell'Atto 2.

**🖥️ Azione:** in chat:

> "Crea una campagna outbound per il Galaxy 27, con una breve comparazione col modello precedente (S26), usando il numero outbound 686fd112a91849a9e59a5353, e chiama chi preferisce il telefono."

**🎙️ Script (beat):**
> *(`upsert`)* "L'agente crea la **scheda campagna**: prodotto, confronto col modello precedente, config telefonica (9–18, lun–ven, fuso Roma, 3 tentativi). Dietro le quinte, senza codice."
>
> *(`create`)* "Ora crea la **Pearl su NLPearl** — l'agente vocale. Parte **in pausa**: nessuna chiamata finché non la attivo io."
>
> *(`send` → anteprima + conferma)* "Ora definisce *chi chiamare*: solo chi ha il consenso telefonico — qui **Lorenzo**. E **chiede a me la conferma** prima di mandare i lead." *(Confermare → `leadsCreated: 1`.)* "La campagna è pronta, ancora in pausa."

**👀 Pubblico vede:** tool-call `upsert→create→send`; scheda con Voice Brief; Pearl `Paused`; gate di conferma; `leadsCreated: 1`.

**Regole sul palco:** `send`/`resume` solo dietro conferma esplicita (`confirm: true`). Il numero outbound va sostituito con quello **verificato** per l'account (vedi Note NLPearl nel runbook).

---

## Atto 2 — La prima chiamata vera: memoria + campagna in una chiamata (5 min)

**🖥️ Azione:** confermare `resume` → il Pearl NLPearl chiama **davvero** il telefono del presentatore (numero di Lorenzo). Vivavoce; seguire il copione.

**📞 SCRIPT CHIAMATA OUTBOUND (Pearl campagna → Lorenzo):**
> **[AI]** "Buongiorno Lorenzo, una chiamata per conto di Crm-A Console. Vorremmo presentarle una nuova offerta."
> **[Lorenzo]** "Buongiorno. Mi interessa — vi ho comprato il Galaxy S26, che offerta c'è per me?"
> **[AI]** *(dal Voice Brief)* "Il nuovo Galaxy S27 arriva il 18 ottobre: chip più veloce, batteria maggiore, fotocamera molto migliorata in bassa luce, sette anni di aggiornamenti. E per i possessori del Galaxy S26 c'è la promo di lancio: **fino a 150 euro di bonus permuta**."
> **[Lorenzo]** "Mi interessa. Potete ricontattarmi? E datemi pure la promo."
> **[AI]** *(raccoglie il consenso esplicitamente)* "Certamente. Confermo il suo consenso a ricevere comunicazioni di marketing e ad essere ricontattato per il lancio. Preferisce il telefono?"
> **[Lorenzo]** "Sì, il telefono va bene."
> **[AI]** "Perfetto. La ricontatteremo al lancio. Grazie Lorenzo, buona giornata."

*(L'AI improvvisa dal Voice Brief: battute attese, non copione cablato.)*

**Dopo la chiamata:**
1. Dashboard NLPearl: chiamata completata, trascrizione + summary.
2. Console → profilo Lorenzo: **timeline** aggiornata con la nuova interazione `Call` (il webhook ha riconosciuto il numero e l'ha agganciato alla persona giusta).
3. Scheda campagna: stato lead → **Success**.
4. In chat: "Consolida i dati della chiamata: consenso marketing sì, canale preferito telefono." *(l'agente aggiorna il profilo; il consenso non si auto-scrive.)*

**🎙️ Script:** "Il telefono squilla davvero. E qui la Console riconosce il numero, lo aggancia a Lorenzo — non è un estraneo, è un cliente nato dall'acquisto — e registra l'esito in timeline. Poi io chiedo all'agente di consolidare il consenso: marketing sì, canale telefono. Un contatto pieno, con la sua storia."

**👀 Pubblico vede:** telefono che squilla + voce AI; call record NLPearl; interazione `Call`; campaign_send `Success`; profilo aggiornato.

---

## Atto 3 — Il CRM diventa memoria (Copilot) (2 min)

**🖥️ Azione:** in chat:

> "Stiamo lanciando il nuovo Samsung Galaxy. Qual è il pubblico migliore a cui proporlo?"

**🎙️ Script:** "Ora il CRM ragiona. Niente query scritte: l'agente usa la sua skill, legge segmento e consensi, e risponde. Ecco Lorenzo in lista — cliente S26, consenso sì, canale telefono. Una base dati *viva*, non un foglio Excel."

**👀 Pubblico vede:** risposta con la lista del pubblico e il ragionamento su canali e consensi.

---

## Atto 4 — Orchestrazione multicanale (4 min)

**🖥️ Azione:** in chat:

> "Prepara il brief di lancio del Galaxy 27, con il confronto col modello precedente, e invia l'annuncio al segmento 'Lancio Samsung Galaxy' per canale preferito."

**🎙️ Script (beat):**
> *(L'agente scrive `brief-galaxy-s27.md` e lo apre.)* "Il prodotto 'viaggia' come un brief di marketing: caratteristiche, differenze col S26, promo, link d'acquisto — la stessa conoscenza che ha parlato al telefono nell'Atto 2."
>
> *(L'agente lancia l'invio multicanale e mostra il risultato.)* "Stessa campagna, instradata **per canale preferito**: chi ha scelto Telegram la riceve su Telegram, chi email su email. Ecco il risultato: `sent`, i destinatari per canale, `failed: []`."

**👀 Pubblico vede:** `brief-galaxy-s27.md`; JSON `{ ok, sent, telegram:[…], email:[…], failed:[] }`.

**Nota onesta:** l'invio reale richiede i canali collegati. Se in prova qualche canale fallisce, narrarlo: "i canali live della demo sono il telefono — l'avete appena visto". Collaudare prima.

---

## Atto 5 — Il cliente richiama: la memoria risponde (5 min)

**Obiettivo:** il momento "wow": Lorenzo richiama e la Console lo riconosce — nome, ordine in consegna, e la nuova offerta.

**🖥️ Azione:** il presentatore, dallo stesso telefono, **chiama il numero inbound** (Pearl inbound attiva). Vivavoce; narrare prima e dopo; seguire il copione.

**📞 SCRIPT CHIAMATA INBOUND (Lorenzo → Pearl inbound):**
> **[AI]** "Buongiorno Lorenzo, come posso aiutarla?"
> **[Lorenzo]** "Buongiorno, è Crm-A? Volevo sapere del mio Galaxy S26 — dove è la consegna?"
> **[AI]** *(dal contesto restituito dal PreCallAPI)* "Buongiorno Lorenzo. Il suo Galaxy S26 è in consegna con **GLS**: è in carico oggi, consegna prevista **domani entro le 18**. Posso aiutarla con altro?"
> **[Lorenzo]** "Perfetto. E sul nuovo Galaxy S27 che mi avete chiamato: vale la pena passare dal S26?"
> **[AI]** *(dal brief)* "Rispetto al suo S26: chip più veloce, batteria maggiore, fotocamera molto più performante in bassa luce, sette anni di aggiornamenti. Con la promo lancio per i possessori di S26 — fino a 150 euro di bonus permuta — il passaggio è vantaggioso."
> **[Lorenzo]** "Va bene, mi prenoto la promo. Procedete."
> **[AI]** "Perfetto Lorenzo, ho registrato il suo interesse per il Galaxy S27 con la promo di lancio. La ricontatteremo. Grazie e buona giornata!"

**Dopo la chiamata — in chat:**

> "Lorenzo ha confermato la promo per il Galaxy 27. Registra l'ordine."

*(L'agente registra l'ordine/pre-ordine del S27 con la promo.)* Poi, per chiudere il cerchio:

> "Cosa sappiamo di Lorenzo?"

*(L'agente riassume: due ordini — S26 in consegna GLS + S27 pre-ordinato — consenso, canale, timeline.)*

**🎙️ Script:**
> "E adesso il tocco finale. Lorenzo richiama — e ascoltate come il CRM lo riconosce: sa chi è, cosa ha comprato e dove è la consegna: 'in carico oggi, domani entro le 18'. Ha incrociato il brief dell'Atto 4 per il S27 — e ha chiuso il pre-ordine con la promo. Il cliente nato dieci minuti fa da un acquisto è ora una storia: due ordini, un consenso, una campagna, tre interazioni. **Niente più 'chi parla?'. È questo il CRM che ricorda.**"

**👀 Pubblico vede:** chiamata in vivavoce (saluto per nome + stato ordine); timeline che si aggiorna; comando di registrazione ordine; riassunto "cosa sappiamo di Lorenzo".

---

## Chiusura (2 min) — Call to action

**🎙️ Script:**
> "Ricapitolando. Il CRM partiva **vuoto**: il primo record è nato da un touchpoint — un acquisto sull'e-commerce che, via webhook, ha creato l'anagrafica, l'evento e l'ordine. L'operatore ha poi abilitato il consenso e creato la campagna in chat — mai in automatico: ogni invio passa dalla conferma umana. Il telefono ha squillato davvero: una voce vera, un consenso registrato. La stessa conoscenza è diventata un brief multicanale, instradato per canale. E quando il cliente ha richiamato, il CRM lo ha riconosciuto: nome, ordine, consegna, offerta — e ha chiuso il pre-ordine. Crm-A Console: **il CRM che ascolta, ricorda e agisce.** Domande?"

**🖥️ Azione:** aprire le domande. Tenere pronti `DEMO-RUNBOOK.md`, `SHOPIFY-SETUP.md` e `NLPEARL-SERVICES-PROMPT.md` per chi chiede come è costruito.

---

## Raggiungibilità — Tailscale funnel (scelta: Tailscale)

La Console deve essere raggiungibile da NLPearl (callback) **e** da Shopify (webhook ordine).
**Scelta: Tailscale funnel** — già integrato nell'immagine Docker (l'entrypoint si unisce al tailnet,
pubblica la porta 3100 e imposta `CRM_A_CONSOLE_PUBLIC_URL` da solo).

1. Tailscale admin → **reusable auth key**; abilitare **funnel** per il nodo nelle ACL
   (es. `"funnels": [{"dnsName": "crm-a-console", "ports": [3100]}]`).
2. In `.env`:
   ```bash
   TAILSCALE_AUTHKEY=tskey-auth-...
   TAILSCALE_HOSTNAME=crm-a-console
   ```
3. Riavviare: `docker compose up -d --force-recreate`.
4. Verifica nei log: `Tailscale funnel: https://crm-a-console.<tailnet>.ts.net`.
5. Verifica esterna (prep): `curl -s -o /dev/null -w '%{http_code}' https://crm-a-console.<tailnet>.ts.net/api/integrations` → `200`.

*Alternativa non scelta:* **zrok** richiederebbe client/registrazione esterni e l'export manuale di `CRM_A_CONSOLE_PUBLIC_URL`; Tailscale è già nel container.

---

## Checklist pre-demo (una scorsa prima di salire)

- [ ] `pnpm build:crm-a-plugins` + `docker compose up -d --build --force-recreate`
- [ ] `.env`: `CRM_A_PHONE_WEBHOOK_SECRET`, `NLPEARL_ACCOUNT_ID`, `NLPEARL_SECRET_KEY`, `TAILSCALE_AUTHKEY` (+ `TAILSCALE_HOSTNAME`), `SHOPIFY_API_SECRET`, `SHOPIFY_STORE_DOMAIN`
- [ ] Funnel attivo: `https://crm-a-console.<tailnet>.ts.net/api/integrations` → 200
- [ ] **Shopify**: dev store + prodotto SAM-S26 + app custom con webhook `orders/create` e `order/fulfilled` → URL Console (vedi `SHOPIFY-SETUP.md`)
- [ ] Seed eseguito (catalogo+segmento) + **rimosso il contatto "Lorenzo"** del seed (il primo record nasce dal vivo in Atto 0)
- [ ] Pearl **inbound** creata e **attiva** (da `NLPEARL-SERVICES-PROMPT.md` o `/api/nlpearl/inbound`)
- [ ] Numero outbound **verificato**; chiamata outbound **collaudata** (mai la prima volta sul palco)
- [ ] Collaudo webhook Shopify con `scripts/shopify-demo-simulate.sh` (+ `--fulfilled`)
- [ ] Canali Telegram/email (Atto 4) collaudati — o script pronto a narrarne i `failed: [...]`
- [ ] Pearl residue di collaudo rimosse dalla dashboard NLPearl
- [ ] Telefono carico, in vivavoce, numeri (inbound/outbound) a portata di mano; hard refresh browser