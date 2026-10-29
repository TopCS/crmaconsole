# Profilo 360

Vista: `/maxxi/people` (elenco) → `/maxxi/people?id=<personId>` (profilo).
Dal profilo, **Vedi relazioni** apre `/maxxi/graph?focus=<personId>&depth=2`.

L’elenco ha una ricerca server-side per **nome, email o person ID** (`?q=`),
disponibile anche dalla barra superiore della console. Il profilo mostra la coda
di revisione solo quando il candidato è plausibilmente la stessa persona: la
coda globale resta in `/maxxi/sources`.

## Cosa mostra

| Blocco | Contenuto | Fonte |
|---|---|---|
| Intestazione | nome, email, lingua, badge identità verificata/da verificare | `maxxi_person` + confidenza dei link |
| Identità di origine | per ogni link: `source_system`, `source_record_id`, regola (`match_method`), confidenza | `maxxi_identity_link` |
| Consensi | per **scopo × canale**: `granted` / `denied` / `withdrawn` / `unknown` | `maxxi_consent` |
| Membership | prodotto, card code, validità | `maxxi_membership` |
| Organizzazioni | relazioni con organizzazioni (tipo relazione) | `maxxi_relationship` + `maxxi_organization` |
| Timeline | eventi con data, tipo e **fonte:record su ogni riga** | `maxxi_event` |
| Infopoint | casi aperti/chiusi con riepilogo | `maxxi_feedback_case` |
| Possibile duplicato | solo candidati con **stesso nome o stessa email** della persona; record non uniti automaticamente | `maxxi_review_candidate` filtrata |
| Qualità del dato | note esplicite (es. "un acquisto non implica la presenza") | calcolate |

## Esempi nel fixture

**Maria Rossi** (`P-MARIA`) — caso "frammento → persona":
- due fonti collegate: `site_form` (email verificata) e `mymaxxi_manual` (card);
- consenso `event_marketing/email = granted`;
- timeline: modulo inviato, visita effettiva a `X-ARCH-2026`, **acquisto** per
  `X-CALLE-2026` (senza visita attribuita);
- card myMAXXI in scadenza `2026-11-20`.

**Maria Rossi omonima** (`P-MARIA-AMBIG`):
- persona **distinta**, email diversa, nessun link: il record di fonte finisce
  in coda di revisione con motivazione "stesso nome ma identità diversa";
- non viene mai fusa automaticamente.

**Giulia Bianchi** (`P-GIULIA`):
- card in scadenza `2026-11-28`, visita attribuita, feedback infopoint aperto;
- consenso `unknown` → esclusa dalle campagne.

**Ticket anonimo** (`T-ANON-001`):
- evento `exhibition_ticket_purchased` con `person_id = NULL` e
  `anonymous_subject_id` valorizzato; non compare in nessun profilo.

## Trasparenza

- Ogni riga di timeline è riconducibile a un record di origine.
- Il badge "identità da verificare" appare quando la confidenza massima dei link
  è < 0.95.
- Nessun attributo sensibile o inferenza psicografica è presente nel dataset.

## API

`GET /api/maxxi/people` — elenco (max 200).
`GET /api/maxxi/people?id=<id>` — profilo 360 completo. Entrambe richiedono un
principal (operatore o servizio).
