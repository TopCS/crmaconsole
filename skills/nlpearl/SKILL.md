---
name: nlpearl
description: Manage NLPearl.AI voice/text agents (Pearls) — outbound calling campaigns, inbound customer care, leads, voices, phone numbers, call transcripts/analytics. Use when configuring NLPearl credentials, creating/updating Pearls, adding leads, or resolving call/lead outcomes via the API v2, and when driving the console's crm_a_phone_campaign tool.
metadata: { "openclaw": { "inject": true, "emoji": "📞" } }
---

# NLPearl.AI integration (API v2 + console tool)

NLPearl.AI is an AI-powered voice/text agent platform. "Pearls" are autonomous agents that handle inbound/outbound calls and text conversations. In Crm-A Console, NLPearl is the **phone transport** for outbound campaigns and inbound customer-care. You can drive it two ways:

1. **`crm_a_phone_campaign` agent tool** — high-level, opinionated outbound flow (create campaign card → Pearl paused → audience → send/activate), built for the chat operator. **`send`/`resume` require `confirm: true`** (never run them without the operator's explicit go).
2. **`crm_a_inbound_care` agent tool** — high-level inbound customer-care flow (create the inbound Pearl → activate/pause). **`activate` requires `confirm: true`** (creation stays un-gated: it's paused and harmless).
3. **Raw NLPearl API v2** (below) — everything else: list Pearls, voices, phone numbers, calls, transcripts, analytics, inbound config.

**Credentials:** set via the **NLPearl card** in the workspace **Integrations** page (Account ID + Secret Key), or env `NLPEARL_ACCOUNT_ID` / `NLPEARL_SECRET_KEY`. The console webhook route also needs `CRM_A_PHONE_WEBHOOK_SECRET`.

**Base URL:** `https://api.nlpearl.ai/v2`

## When to Use

- Managing AI voice/text agents (Pearls) programmatically
- Driving an outbound calling campaign (prefer `crm_a_phone_campaign`, or raw API for fine control)
- Creating/activating the inbound customer-care Pearl (prefer `crm_a_inbound_care`)
- Adding leads for outbound calling
- Retrieving call recordings/transcripts and analytics
- Managing blacklists and phone numbers

## Authentication

```
Authorization: Bearer <AccountId>:<SecretKey>
```
Token format: literally `AccountId:SecretKey` concatenated (one Bearer string).

## Quick Reference (API v2)

### Account

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v2/Account` | Account details (name, totalAgents, creditBalance) |
| GET | `/v2/Account/Voices` | Available voices (grouped per language) |
| GET | `/v2/Account/PhoneNumbers` | Phone numbers (NOT all are outbound-authorized) |
| POST | `/v2/Account/Blacklist/{Search,Add,Remove}` | Blacklist management |

### Pearl (Agents)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v2/Pearl` | All Pearls |
| GET | `/v2/Pearl/{pearlId}` | Single Pearl |
| PUT | `/v2/Pearl/{pearlId}/Active` | Enable/disable (`isActive: true/false`) |
| POST | `/v2/Pearl/Voice` | **Create** voice Pearl (node graph; response = Pearl ID as plain text) |
| POST | `/v2/Pearl/{pearlId}/Calls` | Get calls (fromDate, toDate, statuses, skip, limit) |
| POST | `/v2/Pearl/{pearlId}/Analytics` | Analytics (from/to, max 90 days) |

**Pearl type:** 1=Inbound, 2=Outbound
**Pearl status:** 1=Running, 2=Paused, 3=Suspended

### Outbound (Leads)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/Outbound/{pearlId}/Lead` | Add single lead |
| POST | `/v2/Outbound/{pearlId}/Leads/Add` | Add leads (max 50,000) |
| PUT/GET | `/v2/Outbound/Lead/{leadId}` | Update / get lead |
| GET | `/v2/Outbound/Lead/External/{externalId}` | Get lead by external ID (used to map webhook → campaign_send) |
| GET | `/v2/Outbound/Lead/Phone/{phone}` | Find by phone |
| POST | `/v2/Outbound/Lead/Search` | Search leads |

### Call

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v2/Call/{callId}` | Transcript, recording, duration, summary, collectedInfo |
| GET | `/v2/Call/{callId}/Recording` | Recording |

**Conversation status:** 10=NotAnswered, 35=InQueue, 40=OnGoing, 70=VoiceMailLeft, 100=Success, 110=NotSuccessful, 130=Completed, 150=Unreachable, 220=Blacklisted, 300=QueueAbandon, 500=Error

## Pearl Flow (Node Graph)

A Pearl flow is a **directed graph** of nodes connected by transitions.

### Node Types (subset relevant here)

| nodeType | Name | Channel | Carries |
|----------|------|---------|---------|
| 2 | OpeningSentence | Both | script (+ instructions) |
| 3 | PreCallAPI | Both | apiSettings |
| 10 | Dialogue | Both | script (+ instructions) |
| 40 | API | Both | apiSettings |
| 100 | EndCall | Both | transitions to post-call only |
| 200 | PostCallActions | Both | postCallActions array |

### Node Structure

```json
{
  "nodeId": "speak",   // unique, max 20 chars — YOU choose it
  "name": "Present the offer",
  "nodeType": 10,
  "script": "Buongiorno, una chiamata per conto di Crm-A.",
  "instructions": "Communicate the offer brief: ...",
  "transitions": [{ "name": "Continue", "toNodeId": "end" }]
}
```

### Rules (Console-verified — respect these)

- Exactly **one EndCall**; every path reaches it
- Exactly **one OpeningSentence** (or 1–2 with PreCallAPI); every `nodeId` unique (max 20 chars); transition `name` unique within its node
- **`firstName` / `email` are built-in lead variables — do NOT redeclare them** in `variables`. The `variables` array must be non-empty (use a custom operational var, e.g. `{ id: "customerNote", name: "Nota", group: 2 }`).
- Pearl creation **requires** `pearl.timeZone` (Windows format, e.g. `Romance Standard Time`) and `pearl.companyDescription`; inbound also requires `inbound.waitingSentence`.
- `POST /Pearl/Voice` returns the new Pearl ID as **plain text, not JSON**.
- Lead data goes in **`callData`**, not `variables`.
- **Always live-validate a Pearl creation "paused" before relying on it** — the NLPearl contract has changed in the past (field names, reserved variables).

## Console tool — `crm_a_phone_campaign`

The `crm-a-nlpearl-outbound` extension registers one agent tool for the outbound campaign flow. Actions:

- `upsert` — create/update the campaign card (Name, Nlpearl Phone ID, calling window/TZ/days, Max Attempts, Retry Rate, Agent Count, **Voice Brief** → the offer the Pearl should speak). Pass `segmentName` when the operator names a segment (e.g. "Lancio Samsung Galaxy") — it is resolved by name and linked on the card; the send audience then scopes to it automatically.
- `create` — build the NLPearl Voice Pearl on NLPearl (**paused**, nothing dialed). The Pearl is NAMED after the campaign title (recognizable on the NLPearl dashboard). Passes the Voice Brief (condensed ≤ 250 chars — NLPearl's node instruction cap) as the node instructions.
- `send` — enqueue the phone-compliant audience (opt-in + preferred channel) as leads; optional `criteria { segmentId?, count? }`; **requires `confirm: true`**. If the campaign has no Pearl yet, send **auto-creates one (paused)** — Pearl ID is never missing at send time.
- `pause` / `resume` — toggle Pearl activity; `resume` **requires `confirm: true`** (starts dialing → credits).


**Campaign deletion:** when a phone campaign is deleted from the CRM, its Pearl is **paused** and the enqueued leads are removed via `DELETE /Outbound/{pearlId}/Leads/External` (NLPearl's API has **no Pearl DELETE**) — an orphaned Pearl can never be activated into calling anyone.
**Safety rule (non-negotiable):** `send` and `resume` must ALWAYS be gated behind the operator's explicit confirmation (`confirm: true`). Never auto-send or auto-activate. Prefer small `count` (3–5) in demos — `addLead` is serial and the tool call times out at 60s for large audiences.

## Console tool — `crm_a_inbound_care`

The `crm-a-nlpearl-outbound` extension also registers `crm_a_inbound_care` for the inbound customer-care flow. It calls `POST /api/nlpearl/inbound`. Actions:

- `create` — build the inbound customer-care Pearl (**paused**): PreCallAPI node looks up the caller's phone in the CRM before the greeting (known → greet by name + order/delivery context; unknown → generic greeting), then a dialogue node carries the offer brief. Params: `name`, `phoneId` (inbound number), `brief` (Marketing Message MD).
- `activate` — make the inbound number answer calls. **Requires `confirm: true`** (turns on a live inbound line).
- `pause` — stop answering (no confirmation required; safe).

**Safety rule:** `activate` must ALWAYS be gated behind `confirm: true`. Creation is safe (paused, nothing answers). Validate the Pearl was created paused before relying on it (the NLPearl contract has changed in the past).

## Recipes

### List Pearls
```bash
curl -s "$BASE/Pearl" -H "Authorization: Bearer $ID:$KEY"
```

### Add a lead
```bash
curl -s -X POST "$BASE/Outbound/{pearlId}/Lead" \
  -H "Authorization: Bearer $ID:$KEY" -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+393331234567","externalId":"CRM-001","callData":{"firstName":"Mario"}}'
```

### Get a call with transcript
```bash
curl -s "$BASE/Call/{callId}" -H "Authorization: Bearer $ID:$KEY"
```

### Analytics (max 90 days)
```bash
curl -s -X POST "$BASE/Pearl/{pearlId}/Analytics" \
  -H "Authorization: Bearer $ID:$KEY" -H "Content-Type: application/json" \
  -d '{"from":"2026-05-01T00:00:00Z","to":"2026-08-10T23:59:59Z"}'
```

## Common Pitfalls

1. **Auth format**: `Bearer AccountId:SecretKey` as ONE string.
2. **Lead path**: `/v2/Outbound/{pearlId}/Lead`, not `/v2/Outbound/Lead`.
3. **`callData` not `variables`** for lead data; `firstName`/`email` are built-ins (don't redeclare).
4. **Phone E.164**: `+393331234567`, not `3331234567`.
5. **Create Pearl** is `/v2/Pearl/Voice`; response is plain text (Pearl ID).
6. **`pearl.nodes` is a full replace** — fetch current graph first, then modify, then resend.
7. **nodeId max 20 chars**; transition names are plain-language conditions.
8. **Not all phone numbers are outbound-authorized** — pick a working `phoneNumberId` (probe).
9. **Webhook callbacks need a public origin** (`CRM_A_CONSOLE_PUBLIC_URL` or tunnel) to be testable end-to-end.

## Verification Checklist

- [ ] Auth: `Bearer AccountId:SecretKey`
- [ ] Resolve Pearl IDs / voices / a working phoneNumberId first
- [ ] Node graph: exactly 1 EndCall, 1 OpeningSentence; all nodeIds unique ≤20 chars; all toNodeId exist
- [ ] `variables` non-empty and does NOT redeclare `firstName`/`email`
- [ ] Pearl create: `timeZone` (Windows) + `companyDescription` present; validate paused before use
- [ ] Phone E.164, dates ISO 8601; analytics ≤90 days
- [ ] `send`/`resume` only with operator `confirm: true`
