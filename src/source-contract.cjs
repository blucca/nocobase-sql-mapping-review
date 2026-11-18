'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');

const clone = (value) => JSON.parse(JSON.stringify(value));

function readOriginals(root, manifest) {
  const files = {};
  for (const item of manifest.files) {
    const text = fs.readFileSync(path.join(root, item.path), 'utf8');
    files[item.key] = {
      text,
      tree: ts.createSourceFile(item.path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    };
  }
  return files;
}

function nodes(tree, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function variable(file, name) {
  const found = nodes(file.tree, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name);
  assert.equal(found.length, 1, `Expected one original variable ${name}`);
  return found[0].initializer.getText(file.tree);
}

function originalFunction(file, name) {
  const found = nodes(file.tree, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(found.length, 1, `Expected one original function ${name}`);
  return found[0].getText(file.tree).replace(/^export\s+/, '');
}

function classDefault(file, name) {
  const found = nodes(file.tree, (node) => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.equal(found.length, 1);
  return found[0].members.find((node) => ts.isPropertyDeclaration(node) && node.name.getText() === 'default')
    .initializer.getText(file.tree);
}

function jsxCallback(file, tag) {
  const found = nodes(file.tree, (node) => ts.isJsxAttribute(node) && node.name.getText() === 'onChange'
    && node.parent.parent.tagName.getText() === tag);
  assert.equal(found.length, 1, `Expected one original ${tag} onChange`);
  return found[0].initializer.expression.getText(file.tree);
}

function evaluate(text, bindings) {
  const context = vm.createContext(bindings);
  const code = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(code, context);
  return context;
}

function expression(text, bindings) {
  return evaluate(`globalThis.result = (${text});`, bindings).result;
}

function loadSourceContract(root, manifest) {
  const files = readOriginals(root, manifest);
  const mapping = files.mapping;
  const firstEffect = nodes(mapping.tree, (node) => ts.isCallExpression(node) && node.expression.getText() === 'useEffect')[0];
  assert(firstEffect, 'Original first-row mapping effect is present');
  const numberDefault = clone(expression(classDefault(files.numberInterface, 'NumberFieldInterface'), {}));
  const dateDefault = clone(expression(classDefault(files.datetimeInterface, 'DatetimeFieldInterface'), {}));
  const miniDecimal = require('@rc-component/mini-decimal');
  const formatterBindings = {
    ...miniDecimal,
    isValid: require('@formily/shared').isValid,
    toString: require('lodash').toString,
    BigNumber: require('bignumber.js'),
    math: require('mathjs'),
    format: require('d3-format').format,
  };
  const names = [
    'countDecimalPlaces', 'formatNumberWithSeparator', 'formatBigNumberWithSeparator',
    'formatUnitConversion', 'scientificNotation', 'formatNumber',
  ];
  const formatter = evaluate([
    originalFunction(files.decimal, 'toFixedByStep'),
    `const separators = ${variable(files.readPretty, 'separators')};`,
    ...names.map((name) => originalFunction(files.readPretty, name)),
    'globalThis.formatNumberOriginal = formatNumber;',
  ].join('\n'), formatterBindings).formatNumberOriginal;

  function createMapping(data, sourceFields, getCollectionField, existing = []) {
    const field = { value: clone(existing), setValue(value) { this.value = value; } };
    const registry = {
      number: { default: numberDefault }, datetime: { default: dateDefault },
      input: { default: { type: 'string', uiSchema: { type: 'string', 'x-component': 'Input' } } },
    };
    const bindings = {
      data, sourceFields, field, loading: false, curFields: undefined,
      refGetInterface: { current: (name) => registry[name] },
      inferInterface: expression(variable(mapping, 'inferInterface'), { dayjs: require('dayjs') }),
      setDataSource(value) { bindings.dataSource = value; },
    };
    const effect = expression(firstEffect.arguments[0].getText(mapping.tree), bindings);
    effect();
    // vm has its own global object; pass the current data-source array to each exact handler invocation.
    function handle(record, index) {
      const handler = expression(variable(mapping, 'handleFieldChange'), {
        dataSource: field.value, field, setDataSource(value) { bindings.dataSource = value; },
      });
      handler(record, index);
    }
    function change(tag, name, value) {
      const index = field.value.findIndex((item) => item.name === name);
      assert(index >= 0);
      const callback = expression(jsxCallback(mapping, tag), {
        field: field.value[index], index, sourceFields, getCollectionField, handleFieldChange: handle,
      });
      callback(value);
    }
    return {
      fields: () => clone(field.value),
      selectSource: (name, value) => change('Cascader', name, value.split('.')),
      setTitle: (name, title) => change('Input', name, { target: { value: title } }),
    };
  }

  return {
    createMapping, numberDefault, dateDefault,
    inferInterface: expression(variable(mapping, 'inferInterface'), { dayjs: require('dayjs') }),
    formatNumber: (value, step) => formatter({ value, step, separator: '0.00', formatStyle: 'normal' }),
    extraction: {
      compiler: ts.version,
      mapping: ['inferInterface', 'first useEffect', 'handleFieldChange', 'Cascader onChange', 'Input onChange'],
      rendering: ['ReadPretty formatNumber and its original helper functions', 'toFixedByStep'],
      boundary: 'Exact source bodies transpiled into VM functions. Fixture metadata lookup and field-value cells are explicit bindings; no React mount, HTTP action, or application save is simulated.',
    },
  };
}

module.exports = { loadSourceContract, clone };
