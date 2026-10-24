# subedei

Багшийн автомат туслах: ирц, хоцорсон эцэг эх рүү залгах, SMS, хурлын сануулга

An erxes plugin outside the erxes monorepo: `api/` (Node.js 22,
Express 5 + Apollo Server federated subgraph) and `ui/` (React 18 Module Federation remote). `erxes.json`
is the single source of the plugin's identity and ports.

## Commands

- `npm install`
- `npm run dev:api` / `npm run dev:ui`
- `npm run codegen`
- `npm run check`, `npm run lint`, `npm run build`, `npm run fmt`
- `docker build --build-arg UI_ENTRY_URL=<remoteEntry.js URL> -t <image> .`

Run `check`, `lint` and `build` before calling a change done.

## Naming invariants

See `docs/erxes-integration.md`. In short:

- `erxes.json` `name` (`subedei`) drives Redis keys, `ENABLED_PLUGINS`, the
  docker host `plugin-subedei-api` and the CDN folder `subedei_ui`.
- `ui.name` (`subedei`) is `CONFIG.name`, the page expose `./subedei`,
  and the API permission identity. Keep the public name, including dashes;
  `ui.remote` (`subedei_ui`) is what core-api derives from `name`.
- Change names only in `erxes.json`, and only all together.

## Contracts

- `api/src/gateway.ts` mirrors erxes-api-shared `joinErxesGateway`: same Redis
  keys, same config JSON shape, and in production the router-update lock plus
  the BullMQ `gateway-update-apollo-router` job. Do not drop the job.
- `api/src/context.ts` is the only place that reads gateway headers (`user`,
  `hostname`/`nginx-hostname`). Resolvers receive `{ subdomain, user }`.
- Prefix every GraphQL type with `Subedei` and every operation and root
  field with `subedei`; the supergraph is shared by all plugins.
- `ui/src/config.tsx` exports `CONFIG`; `ui/src/Main.tsx` exports `Subedei`;
  the only baseline exposes are `./config` and `./subedei`. The plugin owns
  `/subedei/settings` and its sidebar through `AppLayout`; the host does not
  mount a separate settings expose. Keep `ui/rspack.config.ts` in sync with
  `erxes.json`. Add notification widgets only when implementing notifications.
- `api/src/print-schema.ts` prints `typeDefs` from `api/src/graphql/schema.ts` to `api/generated/schema.graphql`.
- `erxes-ui`, `ui-modules` and `erxes-api-shared` are the npm packages
  `@erxes/ui`, `@erxes/ui-modules` and `@erxes/api-shared`, installed under
  those import names with exact npm aliases. The tested cohort is
  `3.3.2`; update all three together and validate the deployment.

## Rules

- No `any`; named exports (default export only where a tool requires it, e.g.
  `rspack.config.ts`).
- The `hostShared` list in `ui/rspack.config.ts` (`react`, `react-dom`,
  `react-router`, `react-router-dom`, `@apollo/client`, `jotai`,
  `react-i18next`, `erxes-ui`, `ui-modules`) mirrors core-ui's shared
  singletons: they stay `import: false` and are never bundled — the host
  provides them at runtime. Keep the list in sync with core-ui's
  `coreLibraries`.
- `erxes-ui`/`ui-modules` imports resolve to the shared singleton at runtime,
  so the installed versions should match the host's — they only decide what
  TypeScript and Rspack resolve against.
- UI classes use the `subedei:` Tailwind prefix and the host tokens
  (`bg-background`, `text-muted-foreground`, `border-border`, …).
- Authorize in the API using `context.user`; the UI route guard is not a
  security boundary. Platform data resolvers must also await
  `checkPermission(action)` and use tenant-bound models and bounded pagination.
  Forwarded identity/tenant headers are trusted gateway assertions, not
  authentication: keep API ports private and strip client identity headers at
  the public ingress. See the integration docs before deployment.
- Every query has loading, error and empty states; refetch or update the
  Apollo cache after each mutation.
- GraphQL documents are `gql()` from `~/gql` — generated into `ui/src/gql/`
  by `codegen` from `api/generated/schema.graphql` — written as a function
  call on a static string with no `${}` interpolation.
- Apollo hooks infer their types from the document: no `useQuery<T>` or
  `useMutation<T>` generics and no handwritten response interfaces; derive
  types from the generated `*Query` types.
- `api/generated` and `ui/src/gql` are gitignored; `check`, `build` and
  `dev:ui` run `codegen` first. Run `npm run codegen` after changing a
  document or the schema.
