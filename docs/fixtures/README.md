# Fixture sintetiche MAXXI: istruzioni

`maxxi_demo_seed.json` contiene il dataset **canonico di test** e gli oracoli minimi `expected_for_reference_seed`. Le sotto-directory CSV sono mock di alimentazione, volutamente semplificati. **Non rappresentano i tracciati effettivi** di Archeoares, myMAXXI, biblioteca, Wordpress o infopoint.

## Regola importante per il resolver

Nei `source_records` JSON il campo `expected_person_id` e' **solo l'oracolo di test**. NON e' un campo presente nella fonte reale e NON deve essere usato come scorciatoia per unire le identita'. Gli identity link devono emergere da ID verificati/email verificata/codici card nello stesso namespace e dalle regole documentate in `03_MAXXI_DATA_CONTRACT.md`.

## Regole di importazione

- `row_type=validated_entry` e `row_type=purchase_only` NON sono equivalenti: l'acquisto di un biglietto non dimostra l'ingresso.
- `T-ANON-001` non ha card/identificativo e deve rimanere anonimo.
- L'omonima `P-MARIA-AMBIG` non deve unirsi a `P-MARIA` per la sola coincidenza del nome.
- Il consenso nel form mock non sostituisce le evidenze del registro `consents`. Importare il registro applicando versioni e revoche; consenso `unknown` non equivale a consentito.
- Gli import XLS reali vanno costruiti solo dopo aver ottenuto i tracciati dal fornitore; questo pacchetto NON comprende un'API Archeoares.
- Gli ID e i timestamp qui usati sono tutti fittizi. Nessun provider esterno deve essere chiamato.

## Controlli di coerenza attesi

- Il seed JSON include 200 persone, 167 membership, 399 eventi e 2 mostre pubbliche nel catalogo; le otto persone di riferimento restano invariate.
- Il segmento architettura/rinnovo con consenso email comprende `P-MARIA` e `P-ELENA` nel dataset minimo di riferimento.
- `P-GIULIA` e `P-PAOLO` vanno esclusi dall'audience per assenza o ritiro del consenso marketing (a parita' delle altre condizioni).
- Importare due volte le stesse sorgenti non deve creare duplicati.

Se l'harness genera ulteriori persone sintetiche, i numeri di questo oracolo vanno verificati **sul seed minimo** prima dell'estensione, non confrontati contro il seed espanso.
