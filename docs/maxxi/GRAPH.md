# Grafo delle relazioni — MAXXI demo

Vista: `/maxxi/graph`  
API: `GET /api/maxxi/graph`, `GET /api/maxxi/graph/node?id=<nodeId>`

## Cosa mostra

Il grafo legge **solo** il database demo isolato (`<stateDir>/maxxi-demo/maxxi.duckdb`).
Non usa `/api/crm/graph` né il workspace CRM condiviso: lo schema MAXXI è
diverso e i due ambienti non vanno mescolati.

Nodi:

| Tipo | Fonte | Esempio |
|---|---|---|
| Persona | `maxxi_person` | `P-MARIA` |
| Organizzazione | `maxxi_organization` | `O-PARTNER` |
| Mostra/evento | `maxxi_catalog_item` | `X-ARCH-2026` |
| Interesse | `maxxi_person_interest` (espliciti) | `interest:architecture` |
| Fonte | `maxxi_source_registry` | `source:site_form` |

Relazioni:

| Etichetta | Significato |
|---|---|
| Fonte | identificativo collegato (identity link) |
| Interesse | interesse esplicito della persona |
| Contatto | relazione persona → organizzazione |
| Visita | evento `museum_visit_attended` con catalogo |
| Acquisto | evento `exhibition_ticket_purchased` con catalogo |
| Possibile duplicato | due persone con lo stesso nome e un candidato in revisione |

“Possibile duplicato” è **un’indicazione di revisione**, non un’identità
confermata. Non viene mai presentato come collegamento certo.

## Interazione

- clic su un nodo → dettaglio laterale (o sotto il canvas su mobile);
- dettaglio persona → **Apri profilo 360**;
- filtro per tipo e ricerca testuale sui label;
- focus via link: `/maxxi/graph?focus=P-MARIA&depth=2`;
- apertura diretta del dettaglio: `/maxxi/graph?node=P-MARIA`;
- dal profilo visitatore, **Vedi relazioni** apre il focus a due hop.

## Permessi

L’API richiede `maxxi.people.read`; la pagina è nella `PAGE_ROLES` per
`admin`, `communication`, `membership`, `infopoint`. Il ruolo `relations` non
vede il grafo delle persone: viene rediretto alla dashboard e l’API risponde
403. Le note private infopoint non sono incluse nei campi del nodo persona.

Per il principal `service` valgono le stesse regole read-only.

## Prestazioni e cache

La proiezione esegue diverse query sul DuckDB demo. Il risultato viene
memorizzato per 10 secondi; il seed invalida la cache. La prima apertura può
richiedere alcuni secondi, le successive sono immediate.

## Limiti dichiarati

- È una proiezione **read-only**; non modifica identità, consensi o campagne.
- Il grafo non è un database a grafo: usa le tabelle relazionali del demo.
- Non mostra le note infopoint né i record anonimi non collegati.
- La relazione “Possibile duplicato” deriva da un’euristica sul nome; la
  decisione resta nella coda di revisione in **Fonti dati**.
- Non c’è ancora una query in linguaggio naturale specifica per questo grafo.
