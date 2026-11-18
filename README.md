# NocoBase SQL mapping review

A small native check of the **existing field-source repair** for NocoBase 2.2.44 SQL collections. It keeps the original query, NUMERIC gross calculation, output aliases, and all 18 field mappings. The fixture uses fictional invoices and eight fixed decimal expected values.

**Recorded run, 2026-11-19: PASS** — PostgreSQL 16.15, official NocoBase 2.2.44 classes, eight records and 18 aliases. [PASS result](evidence/result.json) · [Eight formatted gross values](evidence/reloaded.formatted.json).

## Supported owner operation

1. Open the affected SQL collection's **Configure fields → Sync from database**.
2. In the `invoice_amount_gross` row, choose **Invoices → amount** under **Field source**.
3. Restore the gross/including-VAT display title. Source copying includes the net field's title. For these two-decimal invoice values, use numeric precision **0.01**; step **1** formats `361.20` as `361`.
4. Submit the **complete 18-row mapping**, changing only the gross row. Keep the original SQL unchanged.
5. Refresh the collection/page and check the gross column. An explicit block-level DatePicker override requires replacing only that column from the corrected collection field.

The acceptance values include **48000.00**, **300.00**, **361.20**, **24012.00**, and **6000.00**. The first value distinguishes calculated gross from net **40000**.

## Native reviewer entry

Use an isolated PostgreSQL **16.15** database named `nocobase_mapping_fixture`, user `review`, default port **55472**. This review recreates four fictional fixture tables in that database. The owner's live database stays on its ordinary UI workflow above.

Install the pinned package dependencies with:

```sh
npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund
```

Original NocoBase source is external. `upstream.json` records its paths, version, commit URLs, and license scope. Download the five originals to a temporary directory:

```sh
node src/fetch-upstream.cjs /absolute/temp/nocobase-originals
```

Supply the unchanged **Query 2** from [the original report](https://github.com/nocobase/nocobase/issues/11472#issuecomment-6819079886) as `/absolute/temp/query2.sql`. The review compares that SQL directly before/after mapping and after metadata reload.

Run all assertions through one entry:

```sh
PGHOST=127.0.0.1 PGPORT=55472 PGUSER=review \
  node src/review.cjs \
  --sources /absolute/temp/nocobase-originals \
  --query /absolute/temp/query2.sql \
  --out /absolute/temp/nocobase-result
```

An existing runtime can supply `NODE_PATH=/path/to/runtime/node_modules` and `TYPESCRIPT_PATH=/path/to/typescript`. No repository or client build is needed.

## What runs

- Real PostgreSQL executes the unchanged Query 2. Gross has NUMERIC **OID 1700**, remains a decimal string, and matches independent literal expected values: five pictured-value fixtures plus three additional cent cases.
- Official `@nocobase/database` and `@nocobase/plugin-collection-sql` **2.2.44** execute SQLCollection/SQLModel, origin-field inference, native Collection field replacement, and generated SELECTs.
- Exact original `inferInterface`, first-row mapping effect, full-array handler, source/title callbacks, and Number/Datetime defaults are extracted from TypeScript source and transpiled into VM functions. Small fixture metadata lookups and value cells provide their inputs.
- The original numeric read-pretty formatting functions and decimal helper format `361.20` with step `0.01`.
- A fresh native Database reconstructs the complete mapping from JSON. Gross keeps its own name and physical/output alias; the other 17 rows, original SQL, and all raw result values remain unchanged.

Outputs preserve before/after/reloaded metadata, raw rows/OIDs, generated SQL, and a PASS or FAIL result.

## Coverage boundary

The save/reload check covers **JSON metadata + native Collection/SQLCollection**, and the client check covers **exact source functions in a VM**. The NocoBase HTTP metadata-save action, complete GUI/table renderer, custom block overrides, and the author's installation are separate acceptance tiers. The author's own successful Run is recorded separately from this fictional native fixture.

## License

MIT applies to this independently written harness and fictional fixtures. NocoBase packages and externally supplied source retain their original licenses and notices. Upstream source and the business query are kept outside this repository.
