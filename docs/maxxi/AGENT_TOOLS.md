# Tool agentici

Due livelli, entrambi **senza invii esterni**.

## 1. Fallback deterministico (sempre disponibile)

`POST /api/maxxi/ask` → `askMaxxi()` in `apps/web/lib/maxxi/agent.ts`.

Non usa alcun provider LLM: risponde con query sul dataset demo e dichiara
sempre `fallback: true`.

| Intento | Trigger | Risposta |
|---|---|---|
| `segment_arch_renewal_45d` | "rinnovo/scadenza" + "architettura/myMAXXI/card" | conteggi, finestra `from`/`to`, esclusi per consenso/identità/dati |
| `person_360` | "chi è / profilo / riepiloga <Nome Cognome>" | fonti, eventi, membership, consensi, stato identità |
| `donations` | "donazion/donator/sponsor/contribut" | **"Non ho evidenze sufficienti"** + spiegazione |
| `campaigns` | "campagn/bozza/comunicazione" | numero bozze e approvazioni simulate |
| `sources` | "fonti/sorgenti/provenienza/qualità" | elenco fonti simulate con conteggi |

Ogni risposta include:

```jsonc
{
  "intent": "...",
  "grounded": true,
  "window": { "from": "2026-10-28", "to": "2026-12-12" },
  "counts": { "eligible": 2, ... },
  "evidence": [{ "kind": "person|event|source|campaign", "id": "..." }],
  "citations": ["maxxi_identity_link", "maxxi_consent", ...],
  "fallback": true
}
```

Fuori perimetro → `grounded: false` e `"Non ho evidenze sufficienti su questo
punto nei dati dimostrativi caricati."` Nessun numero inventato.

## 2. Tool OpenClaw (`extensions/crm-a-maxxi`)

Registrati solo se è configurato un token di servizio
(`CRM_A_SERVICE_TOKEN` o `CRM_A_PHONE_WEBHOOK_SECRET`).

| Tool | Tipo | Parametri |
|---|---|---|
| `maxxi_person_360` | read-only | `personId` oppure `name` |
| `maxxi_segment_arch_renewal` | read-only | — |
| `maxxi_campaign_proposal` | **dry-run** | `subject`, `body`, `confirm: true` |

`maxxi_campaign_proposal` crea **solo una bozza** nel DB demo e una riga di
audit; risponde con `deliveryMode: "dry_run"` e `outboundCalls: 0`. Senza
`confirm: true` rifiuta con `needsConfirmation`.

Nessun tool espone scritture su dati CRM o invii.

## Perché non c'è un server MCP in questa tranche

Il manifest consente MCP "solo se non mette a rischio i gate precedenti".
Esporre MCP oggi significherebbe un secondo perimetro di autenticazione e
autorizzazione (scope, revoca, rate limit) non coperto dai test del gate. La
façade `lib/maxxi/queries.ts` è già il punto da cui derivare i tool MCP in
sicurezza: vedi `docs/maxxi/ADR-ROADMAP.md`.

## Come estendere

1. Aggiungere la funzione in `lib/maxxi/queries.ts` (con `principal` esplicito).
2. Esporre una route `/api/maxxi/*` che usa `guard()` (operatore o servizio).
3. Se serve all'agente, aggiungere un tool in `extensions/crm-a-maxxi/index.ts`
   che chiama quella route.
4. Se è una scrittura: dry-run + audit + `confirm: true`, e un test che provi
   `externalCalls: 0`.

## 3. Modalità Chat AI (Phase 1, ibrida)

La pagina `/maxxi/agent` ha due modalità sullo stesso dataset:

| Modalità | Endpoint | Comportamento |
|---|---|---|
| **Verificato** (default) | `POST /api/maxxi/ask` | motore deterministico, nessun provider |
| **Chat AI** | `POST /api/maxxi/chat` | LLM + tool MAXXI read-only, fallback automatico |

La chat non risponde mai “a memoria”: il system prompt impone almeno una
chiamata a un tool, e il server rifiuta una risposta testuale senza tool
(`answer_without_tools`) o senza evidenze (`tools_without_evidence`). In quei
casi torna al motore verificato.

### Tool esposti alla chat

| Tool | Permesso richiesto | Note |
|---|---|---|
| `maxxi_sources` | `maxxi.view` | fonti, righe, quarantena |
| `maxxi_campaigns` | `maxxi.view` | bozze e audit, nessun invio |
| `maxxi_person_360` | `maxxi.people.read` | **senza** note private infopoint |
| `maxxi_segment_arch_renewal` | `maxxi.people.eligible` | eleggibili/esclusi con motivo |
| `maxxi_ask` | `maxxi.people.eligible` | motore deterministico come tool |

Nessun tool di invio, approvazione, seed o modifica consensi è disponibile.
Per il principal `service` valgono gli stessi tool read-only.

### Fallback e sicurezza

- provider non configurato, timeout, HTTP error, JSON invalido, nessun tool,
  tool sconosciuto → risposta deterministica;
- un rifiuto (“Non ho evidenze sufficienti…”) resta `grounded: false` anche se
  un tool non correlato ha restituito dati;
- per i ruoli senza `maxxi_ask`, il fallback deterministico è volutamente
  ristretto: non può restituire profili o segmenti fuori perimetro;
- audit `maxxi_chat_query` con modalità, tool, modello e motivo del fallback
  (non viene salvata la domanda testuale).

### Configurazione

```bash
# default: openai/gpt-4o-mini (tool calling, costo contenuto)
export MAXXI_CHAT_MODEL=openrouter/openai/gpt-4o-mini
export OPENROUTER_API_KEY=...
```

Senza `OPENROUTER_API_KEY` la modalità Chat AI funziona ma restituisce sempre il
fallback verificato, con badge “Fallback verificato”.

### Test

`apps/web/lib/maxxi/chat.test.ts` copre: permessi per ruolo, tool allowlist,
risposta dopo tool, rifiuto senza tool, tool sconosciuto, tool senza evidenze,
rifiuto non “grounded”, errori/timeout del provider, modello configurabile.
`apps/web/app/api/maxxi/rbac.test.ts` copre 401 anonimo e fallback senza chiave.
