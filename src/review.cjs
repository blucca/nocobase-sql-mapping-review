'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { Database } = require('@nocobase/database');
const { SQLCollection } = require('@nocobase/plugin-collection-sql/dist/server/sql-collection');
const { loadSourceContract, clone } = require('./source-contract.cjs');

const project = path.resolve(__dirname, '..');
const args = {};
for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];
assert(args.sources && args.query && args.out, 'Usage: node src/review.cjs --sources PATH --query PATH --out PATH');
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'upstream.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(project, 'fixtures/expected.json'), 'utf8'));
const originalSQL = fs.readFileSync(args.query, 'utf8');
const normalizedSQL = originalSQL.trim().replace(/;$/, '');
const gross = 'invoice_amount_gross';
const sqlLog = [];
const dbOptions = {
  dialect: 'postgres', username: process.env.PGUSER || 'review', password: process.env.PGPASSWORD || '',
  database: 'nocobase_mapping_fixture', host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 55472),
  tablePrefix: '', underscored: false, logging: (sql) => sqlLog.push(sql),
  pool: { max: 2, min: 0, idle: 1000 },
};

function save(name, value) { fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n'); }
function plainRows(rows) { return clone(rows).sort((a, b) => Number(a.invoice_id) - Number(b.invoice_id)); }
function assertRows(rows) {
  assert.equal(rows.length, expected.rows.length);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...expected.aliases].sort());
    const oracle = expected.rows.find((item) => item.id === Number(row.invoice_id));
    assert(oracle);
    assert.equal(row[gross], oracle.gross, `Exact gross for invoice ${oracle.id}`);
    assert.equal(typeof row[gross], 'string', 'NUMERIC result stays a decimal string');
  }
}

function sourceCollections(contract) {
  const input = (name) => ({ name, type: 'string', interface: 'input', uiSchema: { title: name, type: 'string', 'x-component': 'Input' } });
  const date = (name) => ({ name, ...clone(contract.dateDefault), interface: 'datetime' });
  const numeric = (name, title) => ({
    name, interface: 'number', ...clone(contract.numberDefault),
    uiSchema: { ...clone(contract.numberDefault.uiSchema), title,
      'x-component-props': { ...contract.numberDefault.uiSchema['x-component-props'], step: '0.01' } },
  });
  const id = { name: 'id', type: 'bigInt', interface: 'id', primaryKey: true };
  const common = { autoGenId: false, timestamps: false, underscored: false };
  return [
    { ...common, name: 'projects', fields: [id, input('code')] },
    { ...common, name: 'contracts', fields: [id, input('name'), { name: 'projectID', type: 'bigInt', interface: 'id' }] },
    { ...common, name: 'orders', fields: [id, input('name'), { name: 'contractID', type: 'bigInt', interface: 'id' }] },
    { ...common, name: 'invoices', fields: [
      id, ...['name', 'type', 'type2', 'status', 'billableTo', 'incomingInvoiceFrom', 'invoiceNumber', 'comment'].map(input),
      ...['invoiceDate', 'paymentDate', 'invoicePeriodStart', 'invoicePeriodEnd'].map(date),
      { name: 'billable', type: 'boolean', interface: 'checkbox' },
      numeric('amount', 'Net amount'), numeric('vat', 'VAT percentage'),
      { name: 'orderID', type: 'bigInt', interface: 'id' },
    ] },
  ];
}

function openDatabase(collections) {
  const db = new Database(dbOptions);
  db.collectionFactory.registerCollectionType(SQLCollection, { condition: (options) => Boolean(options.sql) });
  for (const options of collections) db.collection(clone(options));
  return db;
}

async function run() {
  const client = new Client({ host: dbOptions.host, port: dbOptions.port, user: dbOptions.username, password: dbOptions.password, database: dbOptions.database });
  let db;
  let reloaded;
  try {
    await client.connect();
    const version = await client.query('SELECT version() AS version, current_database() AS database');
    assert.match(version.rows[0].version, /PostgreSQL 16\.15\b/);
    assert.equal(version.rows[0].database, 'nocobase_mapping_fixture');
    assert.equal(require('@nocobase/database/package.json').version, '2.2.44');
    assert.equal(require('@nocobase/plugin-collection-sql/package.json').version, '2.2.44');
    const contract = loadSourceContract(args.sources, manifest);
    await client.query(fs.readFileSync(path.join(project, 'fixtures/schema.sql'), 'utf8'));
    for (const row of expected.rows) {
      await client.query(`INSERT INTO invoices
        (id, name, type, type2, status, "invoiceDate", "paymentDate", "invoicePeriodStart", "invoicePeriodEnd",
         billable, "billableTo", "incomingInvoiceFrom", "invoiceNumber", comment, amount, vat, "orderID")
        VALUES ($1,$2,'outgoing','fictional','draft','2026-11-01','2026-11-10','2026-11-01','2026-11-30',true,
                'Fictional customer','Fictional issuer',$3,'Disposable fixture',$4,$5,1)`,
      [row.id, `Fictional invoice ${row.id}`, `FIXTURE-${row.id}`, row.net, row.vat]);
    }
    const raw = await client.query(originalSQL);
    assert.deepEqual(raw.fields.map((field) => field.name), expected.aliases);
    assert.equal(raw.fields.find((field) => field.name === gross).dataTypeID, 1700);
    assertRows(raw.rows);
    save('postgres-raw.json', { version: version.rows[0], fields: raw.fields, rows: plainRows(raw.rows) });

    const origins = sourceCollections(contract);
    db = openDatabase(origins);
    const collection = db.collection({ name: 'invoice_review', sql: originalSQL });
    const preview = await collection.model.findAll({ attributes: ['*'], limit: 5, raw: true });
    const inferred = collection.model.inferFields();
    assert.equal(inferred.invoice_amount.source, 'invoices.amount');
    assert.equal(inferred[gross], undefined, 'Computed gross has no origin-field metadata');
    assert.equal(contract.inferInterface(gross, preview[0][gross]), 'datetime');
    assert.equal(preview[0][gross], '48000.00');
    const getCollectionField = (source) => {
      const [name, field] = source.split('.');
      return db.getCollection(name).getField(field).options;
    };
    const inferredDraft = contract.createMapping(preview, inferred, getCollectionField);
    // This is the stored-metadata input fixture: nullable source values are explicit after JSON loading.
    const storedDateFields = inferredDraft.fields().map((field) => ({ ...field, source: field.source ?? null }));
    const mapping = contract.createMapping(preview, inferred, getCollectionField, storedDateFields);
    const beforeFields = mapping.fields();
    assert.deepEqual(beforeFields.map((field) => field.name), expected.aliases);
    assert.equal(beforeFields.find((field) => field.name === gross).interface, 'datetime');
    assert.equal(beforeFields.find((field) => field.name === gross).type, 'date');
    collection.setFields(clone(beforeFields));
    const beforeAttributes = clone(collection.model.rawAttributes[gross]);
    const beforeRows = plainRows(await collection.model.findAll({ raw: true }));
    assertRows(beforeRows);
    save('before.json', { mapping: beforeFields, grossAttribute: beforeAttributes, rows: beforeRows, inferred });

    mapping.selectSource(gross, 'invoices.amount');
    const sourceSelected = mapping.fields().find((field) => field.name === gross);
    assert.equal(sourceSelected.name, gross);
    assert.equal(sourceSelected.source, 'invoices.amount');
    assert.equal(sourceSelected.uiSchema.title, 'Net amount', 'Original callback copies the source title too');
    mapping.setTitle(gross, 'Gross amount (including VAT)');
    const repairedFields = mapping.fields();
    assert.deepEqual(repairedFields.map((field) => field.name), expected.aliases);
    for (const field of beforeFields.filter((field) => field.name !== gross)) {
      assert.deepEqual(repairedFields.find((item) => item.name === field.name), field, `Other mapping unchanged: ${field.name}`);
    }
    const repaired = repairedFields.find((field) => field.name === gross);
    assert.equal(repaired.interface, 'number');
    assert.equal(repaired.type, 'double');
    assert.equal(repaired.uiSchema['x-component'], 'InputNumber');
    assert.equal(repaired.uiSchema['x-component-props'].step, '0.01');
    collection.setFields(clone(repairedFields));
    assert.equal(collection.getField(gross).name, gross);
    assert.equal(collection.model.rawAttributes[gross].fieldName, gross);
    assert.equal(collection.model.rawAttributes[gross].field, gross);
    assert.equal(collection.model.sql, normalizedSQL);
    assert.deepEqual(Object.keys(collection.model.rawAttributes).sort(), [...expected.aliases].sort());
    const afterRows = plainRows(await collection.model.findAll({ raw: true }));
    assertRows(afterRows);
    assert.deepEqual(afterRows, beforeRows);
    assert.equal(afterRows[0].invoice_amount, 40000);
    assert.equal(afterRows[0][gross], '48000.00');
    assert.notEqual(afterRows[0][gross], String(afterRows[0].invoice_amount));
    save('after.json', { mapping: repairedFields, grossAttribute: clone(collection.model.rawAttributes[gross]), rows: afterRows });

    const metadata = { sourceCollections: origins, sqlCollection: { name: 'invoice_review_reloaded', sql: originalSQL, fields: repairedFields } };
    save('metadata-roundtrip.json', metadata);
    await db.close();
    db = undefined;
    const persisted = JSON.parse(fs.readFileSync(path.join(out, 'metadata-roundtrip.json'), 'utf8'));
    reloaded = openDatabase(persisted.sourceCollections);
    const loaded = reloaded.collection(persisted.sqlCollection);
    assert.equal(loaded.model.sql, normalizedSQL);
    assert.equal(loaded.model.rawAttributes[gross].field, gross);
    assert.equal(loaded.model.rawAttributes[gross].fieldName, gross);
    assert.equal(loaded.getField(gross).options.interface, 'number');
    assert.equal(loaded.getField(gross).options.uiSchema.title, 'Gross amount (including VAT)');
    assert.deepEqual(Object.keys(loaded.model.rawAttributes).sort(), [...expected.aliases].sort());
    const loadedRows = plainRows(await loaded.model.findAll({ raw: true }));
    assertRows(loadedRows);
    assert.deepEqual(loadedRows, beforeRows);
    const formatted = loadedRows.map((row) => ({ id: row.invoice_id, gross: row[gross], display: contract.formatNumber(row[gross], '0.01') }));
    for (const row of formatted) assert.equal(row.display, expected.rows.find((item) => item.id === Number(row.id)).gross);
    assert.equal(contract.formatNumber('361.20', '1'), '361');
    assert.equal(contract.formatNumber('361.20', '0.01'), '361.20');
    save('reloaded.json', { mapping: loaded.getFields().map((field) => field.options), rows: loadedRows, formatted });
    fs.writeFileSync(path.join(out, 'generated-sql.log'), sqlLog.join('\n\n') + '\n');
    const generated = sqlLog.filter((sql) => sql.includes('invoice_review_reloaded'));
    assert(generated.some((sql) => sql.includes('"invoice_amount_gross"') && sql.includes(`FROM (${normalizedSQL})`)));
    const result = {
      status: 'PASS', postgres: version.rows[0].version, node: process.version,
      versions: Object.fromEntries(['@nocobase/database', '@nocobase/plugin-collection-sql', '@nocobase/utils', 'pg', 'dayjs', '@formily/shared'].map((name) => [name, require(`${name}/package.json`).version])),
      records: expected.rows.length, aliases: expected.aliases.length, grossOID: 1700,
      controls: ['original NUMERIC strings infer datetime', 'source selection copies numeric metadata but keeps gross name',
        'source title restored to gross', 'other 17 mappings unchanged', 'native rawAttributes keeps gross field alias',
        'original SQL and all raw values unchanged', 'fresh Database rebuild from JSON metadata',
        'five original-value oracles plus three independent cent cases', 'original numeric formatter preserves 361.20'],
      extraction: contract.extraction,
      boundaries: ['fictional disposable PostgreSQL fixture', 'official NocoBase Database/SQLCollection/SQLModel/query generator',
        'metadata JSON roundtrip and native Collection.setFields, not HTTP metadata-save action',
        'exact mapping/formatting source functions in VM, not complete GUI/table rendering', 'author own installation/Run remains separate'],
    };
    save('result.json', result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (db) await db.close();
    if (reloaded) await reloaded.close();
    await client.end();
  }
}

run().catch((error) => {
  save('failure.json', { status: 'FAIL', message: error.message, stack: error.stack });
  fs.writeFileSync(path.join(out, 'generated-sql.log'), sqlLog.join('\n\n') + '\n');
  console.error(error.stack);
  process.exitCode = 1;
});
