# Prestazioni della demo MAXXI

## Perché la demo era lenta

Il database MAXXI è un file DuckDB isolato. Prima di questa modifica ogni
query avviava un **nuovo processo CLI** che apriva il file in scrittura, e ogni
chiamata riscaricava lo schema (`17 × CREATE TABLE IF NOT EXISTS`). La
panoramica eseguiva **11 query separate in parallelo**; i processi si
contendevano il lock esclusivo del file e riprovavano con backoff.

Le scansioni non erano il problema: lo era il costo per richiesta.

## Cosa è cambiato

1. **Sidecar Quack** (`maxxi-quack` in `docker-compose.yml`): un solo processo
   DuckDB apre il file e lo serve sul protocollo Quack. La console non apre più
   il file: invia SQL al server.
2. **Schema una volta per processo**: `ensureMaxxiSchema()` memorizza il
   risultato, invece di rieseguire il DDL a ogni query.
3. **KPI in una sola query**: `getDashboardKpis()` usa 11 sottoquery scalari in
   un unico statement.
4. **Letture parallele solo su Quack**: `maxxiRun()` parallelizza quando il
   backend è Quack e resta sequenziale sul file diretto, dove il lock esclusivo
   renderebbe il parallelismo controproducente.

La modalità diretta resta il fallback per `next dev`, test e ambienti senza
sidecar: nessuna modifica al comportamento del CRM principale.

## Misure locali (30 ottobre 2026)

Stessa macchina, dataset demo, richieste autenticate a caldo.

| Endpoint | Prima (file diretto) | Dopo (Quack) |
|---|---:|---:|
| `GET /api/maxxi/overview` | 8,43 s | 0,29 s |
| `GET /api/maxxi/status` | 12,41 s | 0,23 s |
| `GET /api/maxxi/people?id=P-MARIA` | 0,72 s | 0,50 s |
| `GET /api/maxxi/segment` | 0,90 s | 0,15 s |
| `GET /api/maxxi/campaigns` | — | 0,22 s |
| `POST /api/maxxi/seed` (reset) | — | 0,43 s |

La prima richiesta dopo un riavvio può includere il warm-up di Next.js; i
numeri sopra sono quelli a regime.

## Configurazione

Compose avvia il sidecar e passa alla console:

```bash
export MAXXI_QUACK_URL=quack:maxxi-quack:9494
export MAXXI_QUACK_TOKEN=<openssl rand -hex 24>
export MAXXI_QUACK_DISABLE_SSL=1   # rete Compose privata, HTTP
```

Il token ha un default solo per la demo locale. In un ambiente condiviso va
sostituito in `.env` e usato lo stesso valore per sidecar e console.

Se `MAXXI_QUACK_URL` o `MAXXI_QUACK_TOKEN` mancano, la console usa il file
DuckDB direttamente (comportamento precedente).

## Verifica

```bash
docker compose ps maxxi-quack
docker compose logs -f maxxi-quack
```

Nella **Panoramica → Stato della demo** il controllo *Dataset demo* riporta
`backend Quack`. Se il sidecar non è raggiungibile, le query MAXXI falliscono
in modo esplicito: non si torna al file diretto mentre il sidecar lo possiede,
per evitare conflitti di lock.

Comando di misura:

```bash
for p in \
  '/api/maxxi/overview' \
  '/api/maxxi/status' \
  '/api/maxxi/people?id=P-MARIA' \
  '/api/maxxi/segment'; do
  curl -s -o /dev/null -b /tmp/admin.jar -w "$p %{time_total}s\n" \
    "http://localhost:3100$p"
done
```

## Sicurezza e limiti

- Quack **non pubblica porte**: resta sulla rete Compose, senza `ports:`.
- Il server richiede un token; TLS è disattivato solo sul segmento interno
  (`disable_ssl = true`). Per un deployment esterno servirebbe un reverse proxy
  TLS, come da documentazione DuckDB.
- Il sidecar espone l’intera superficie SQL del database MAXXI: il token va
  trattato come un segreto, non come un’informazione pubblica.
- Quack è un’estensione di DuckDB 2.0, installata nell’immagine durante la
  build (`INSTALL quack`), così l’avvio non dipende dalla rete.
- L’isolamento dal CRM resta invariato: il sidecar apre solo
  `maxxi-demo/maxxi.duckdb`.
