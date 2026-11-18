'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const manifest = require('../upstream.json');
const dest = process.argv[2];
assert(dest, 'Usage: node src/fetch-upstream.cjs /absolute/temp/originals');

async function run() {
  for (const item of manifest.files) {
    const response = await fetch(item.url);
    assert(response.ok, `${response.status} ${item.url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const file = path.join(dest, item.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    console.log(item.path);
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
