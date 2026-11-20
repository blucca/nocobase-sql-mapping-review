// Source-module control for the reported reload UX: plain main-source collections,
// no collection mixins, and an identity translation transform. A full NocoBase
// browser run is the next tier; this control keeps the real class/provider logic.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const React = require('react');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const { act } = React;
const directory = path.resolve(process.argv[2] || 'temp/reload-context-source');
const output = path.resolve(process.argv[3] || 'temp/reload-context-result.json');
const source = name => fs.readFileSync(path.join(directory, name), 'utf8');
const unused = name => () => { throw new Error(`Unexpected fixture path: ${name}`); };
function load(name, imports, text = source(name)) {
  const code = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText;
  const module = { exports: {} };
  const requireFixture = request => {
    if (request === 'react') return React;
    assert.ok(Object.hasOwn(imports, request), `Declare fixture import ${request}`);
    return imports[request];
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: requireFixture, console }, { filename: name });
  return module.exports;
}
const collection = load('3-Collection.ts', { lodash: { filter: unused('filtered fields') } });
const manager = load('4-CollectionManager.ts', {
  './Collection': collection,
  qs: { stringify: unused('query serialization') },
  './utils': {
    collectionTransform: value => value,
    applyMixins: (Class, mixins, options, owner) => {
      assert.equal(mixins.length, 0);
      return new Class(options, owner);
    },
  },
});
const dataSource = load('2-DataSource.ts', { '../collection': manager });
let activeSource;
let extensions;
const providerImports = {
  '../data-source/DataSourceProvider': { DataSourceProvider: ({ children }) => children, useDataSource: () => activeSource },
  './ExtendCollectionsProvider': { useExtendCollections: () => extensions },
};
const originalProvider = source('6-data-source-CollectionManagerProvider.tsx');
const originalBranch = `    if (extendCollections?.length) {\n      return res.clone(extendCollections);\n    }\n    return res;`;
assert.equal(originalProvider.split(originalBranch).length, 2);
const candidateProvider = originalProvider.replace(originalBranch, '    return res.clone(extendCollections || []);');
const oldMetadata = [{ name: 'calculatedInvoices', fields: [
  { name: 'id', type: 'bigInt' },
  { name: 'gross', type: 'date', interface: 'datetime', uiSchema: { 'x-component': 'DatePicker' } },
] }];
const freshMetadata = [{ name: 'calculatedInvoices', fields: [
  { name: 'id', type: 'bigInt' },
  { name: 'gross', type: 'double', interface: 'number', uiSchema: { 'x-component': 'InputNumber' } },
] }];
class FixtureSource extends dataSource.DataSource {
  next = oldMetadata;
  async getDataSource() { return { collections: this.next }; }
}
async function run(label, providerText, withExtension) {
  const fixtureManager = {
    app: { flowEngine: null }, collectionMixins: [],
    collectionTemplateManager: { getCollectionTemplate: () => undefined },
  };
  activeSource = new FixtureSource({ key: 'main', collections: oldMetadata }, fixtureManager);
  const ds = activeSource;
  extensions = withExtension ? [{ name: 'localExtra', fields: [] }] : [];
  const cmProvider = load('6-data-source-CollectionManagerProvider.tsx', providerImports, providerText);
  const cProvider = load('5-CollectionProvider.tsx', {
    '../collection-field/CollectionFieldProvider': { CollectionFieldContext: React.createContext(null) },
    '../components/CollectionDeletedPlaceholder': { CollectionDeletedPlaceholder: unused('missing collection') },
    './CollectionManagerProvider': cmProvider,
  });
  function Probe() {
    const selected = cProvider.useCollection();
    const field = selected.getField('gross');
    return React.createElement('output', null, `${field.interface}:${field.type}`);
  }
  const element = () => React.createElement(cmProvider.CollectionManagerProvider, null,
    React.createElement(cProvider.CollectionProvider, { name: 'calculatedInvoices' }, React.createElement(Probe)));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element()); });
  const before = container.textContent;
  assert.equal(before, 'datetime:date');
  const originalCollection = ds.collectionManager.getCollection('calculatedInvoices');
  ds.next = freshMetadata;
  await act(async () => { await ds.reload(); });
  const afterReload = container.textContent;
  const newCollection = ds.collectionManager.getCollection('calculatedInvoices');
  const newField = newCollection.getField('gross');
  assert.equal(newField.interface, 'number');
  assert.equal(newField.type, 'double');
  assert.equal(newCollection.getField('id').type, 'bigInt');
  assert.notEqual(newCollection, originalCollection);
  // A normal parent re-render preserves the collection name and manager identity.
  await act(async () => { root.render(element()); });
  const afterParentRender = container.textContent;
  await act(async () => { root.unmount(); });
  container.remove();
  return { label, extension: withExtension, before, managerAfterReload: `${newField.interface}:${newField.type}`,
    collectionReplaced: true, afterReload, afterParentRender };
}
(async () => {
  const stockPlain = await run('stock plain', originalProvider, false);
  assert.equal(stockPlain.afterReload, 'datetime:date');
  assert.equal(stockPlain.afterParentRender, 'datetime:date');
  const stockExtended = await run('stock extended', originalProvider, true);
  assert.equal(stockExtended.afterReload, 'number:double');
  const candidatePlain = await run('candidate plain', candidateProvider, false);
  assert.equal(candidatePlain.afterReload, 'number:double');
  assert.equal(candidatePlain.afterParentRender, 'number:double');
  const result = { status: 'PASS', scope: 'cached v2.2.44 source modules, plain synthetic main-source fields; real React DOM in JSDOM',
    versions: { node: process.version, react: React.version, reactDom: require('react-dom/package.json').version,
      typescript: ts.version, jsdom: require('jsdom/package.json').version },
    results: [stockPlain, stockExtended, candidatePlain],
    proposedBranch: 'always return res.clone(extendCollections || []) for a fresh context identity on reload' };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
