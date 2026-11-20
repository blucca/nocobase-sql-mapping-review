# Fresh collections, stale context

A focused source-module review of the full-page reload reported in [NocoBase #11472](https://github.com/nocobase/nocobase/issues/11472#issuecomment-7044492788). The original SQL and field-source repair stay intact. This review follows the client metadata from a completed data-source reload into the field consumer.

The controlled result is specific: **the manager receives the new Number field, while the ordinary collection provider keeps the old Datetime collection.** An existing extension branch and a candidate context-identity change both display Number immediately.

| Original source-module path | Manager after reload | Field consumer after reload | After a normal parent render |
|---|---|---|---|
| Plain collection, no local extensions | `number:double` | `datetime:date` | `datetime:date` |
| One local extended collection | `number:double` | `number:double` | `number:double` |
| Candidate: fresh context clone, plain collection | `number:double` | `number:double` | `number:double` |

[Complete recorded result](observed-results.json) · [Executable control](check-context.cjs) · [Five immutable source identities](source-files.json)

## The identity boundary

The legacy SQL sync action already calls `refreshCM()`. In the acquired source snapshot, that hook invokes the main data source's `reload()`, then refreshes the schema and its local version. The reload method replaces `CollectionManager.collectionInstancesMap` with **new Collection objects**, and calls its reload callbacks.

The next two providers preserve a different lifetime:

1. `CollectionManagerProviderInner` receives the reload callback and changes its random state. Its memo recomputes, but the ordinary branch returns the **same manager object**. The branch with extended collections returns `res.clone(extendCollections)`, a new context value.
2. `CollectionProvider` memoizes `manager.getCollection(name)` using `[collectionManager, name]`. With the same manager and name, it keeps the old Collection object. A normal parent render keeps those dependencies, too.
3. `Collection.getField()` uses that object's cached field map. Meanwhile, the manager's new map contains a fresh object with the corrected metadata.

```text
reload completes
  manager: same identity, new Collection objects
  context: same identity in the plain branch
  consumer memo: old Collection object and its field map
```

The extension branch is a useful existing control: it changes the context's identity and the consumer refreshes. The candidate applies that same identity boundary to the ordinary branch:

```tsx
const cm = useMemo(() => {
  return collectionManager.clone(extendCollections || []);
}, [collectionManager, extendCollections, random]);
```

This is a proposed branch exercised in memory by the control. Upstream implementation and application validation follow maintainer review. It uses the existing `clone()` method; the SQL query, source mapping, numeric arithmetic and server write path are unchanged.

## Run the control

From this repository's root, place the originals and runtime under `temp/`:

```sh
python3 reload-context/fetch-sources.py temp/reload-context-source
npm install --prefix temp/reload-context-deps --ignore-scripts --no-audit --no-fund \
  react@19.3.1 react-dom@19.3.1 typescript@5.9.3 jsdom@23.0.1
NODE_PATH="$PWD/temp/reload-context-deps/node_modules" \
  node --max-old-space-size=192 reload-context/check-context.cjs \
  temp/reload-context-source temp/reload-context-result.json
```

Expected: `status: PASS` and the three rows above. An existing runtime can supply its `node_modules` through `NODE_PATH`, so these dependencies can be reused.

## Measured seam

The control compiles the original `DataSource`, `CollectionManager`, `Collection`, `CollectionManagerProvider` and `CollectionProvider` modules and renders them through real **React DOM in JSDOM**. The synthetic data source changes a gross field's metadata from Datetime to Number, keeps its field name and ID metadata, and calls the original reload method. Each manager gets a newly allocated Collection.

The fixture supplies a plain main data source, empty collection mixins and an identity translation transform. These collaborators stay fixed across all three arms. Original collection/provider logic, hooks, memoization and DOM updates execute in the real runtime. The candidate changes only the context-return branch in memory.

Recorded runtime: **Node 26.12.0, React/React DOM 19.3.1, TypeScript 5.9.3, JSDOM 23.0.1**. Sources are the immutable blobs recorded from the earlier `v2.2.44` tree `b1ec3c8eee7ecd53b5fe482af3d9339d9bd8965a`; the original SQL/data-plane review keeps its separate npm package/source pin.

The next application check is the owner's post-sync page on its actual client runtime: confirm the loaded metadata, active collection context and saved block schema before the manual full-page reload. The original [eight-row numeric SQL review](../README.md) and the author's applied mapping/reload steps remain their own evidence tiers.

NocoBase's original source and proposed patch retain the upstream licenses and notices. The independently written control and fictional metadata use this repository's MIT license.
