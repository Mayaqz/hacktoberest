# How subedei plugs into erxes

erxes discovers this plugin at runtime through the same Redis used by the API.
Enable `subedei` in `ENABLED_PLUGINS` on the gateway and core-api, and restart
them. No monorepo workspace or source import is required.

## Names

All of these come from `erxes.json`. They must stay consistent.

| Name           | Value                      | Used by                                                        |
| -------------- | -------------------------- | -------------------------------------------------------------- |
| `name`         | `subedei`                 | Redis keys, `ENABLED_PLUGINS`, CDN folder, docker host         |
| `ui.name`      | `subedei`                 | `CONFIG.name`, permissions, page expose `./subedei`                          |
| `ui.remote`    | `subedei_ui`               | Module Federation container (core-api derives it from `name`)  |
| `ui.path`      | `subedei`                 | Route `/subedei/*` in core-ui                                 |
| GraphQL prefix | `subedei` / `Subedei` | Operation, field and type names (unique across the supergraph) |

**Dashed names:** `inventory` maps to `inventory_ui` / `./inventory`;
`inventory-tools` maps to the container `inventory_tools_ui`, page expose
`./inventory-tools`, and page export `InventoryTools`. Its public identity
stays `inventory-tools` in `name`, `ui.name`, `CONFIG.name` and API
`permissions.plugin`; never substitute `inventory_tools` in permission checks.
The host must preserve the discovery remote key separately from CONFIG.name
and resolve dashed module names to PascalCase exports. Those host fixes are
required for dashed plugins; use a single-word name on older hosts. API
authorization remains required regardless of host route guards.

## API registration

On start, `api/src/gateway.ts` writes what erxes-api-shared `joinErxesGateway`
writes:

- `erxesservice:config:subedei`: `{ dbConnectionString, hasSubscriptions, meta, releaseVersion, uiEntry }`.
  `uiEntry` is `UI_ENTRY_URL`; `releaseVersion` is `RELEASE_VERSION` when it
  starts with `3.`, otherwise `latest`.
- `erxes-service-subedei`: the address the gateway proxies to.
  `LOAD_BALANCER_ADDRESS`, else `http://localhost:<port>` in development and
  `http://plugin-subedei-api:<port>` otherwise.
- In production only: the `gateway:update-apollo-router:pending` lock (30 s)
  and a BullMQ job `service-discovery-updated` on queue
  `gateway-update-apollo-router`. Without it a production gateway never
  recomposes the supergraph.

`api/src/context.ts` turns the gateway's forwarded headers — `user` (base64
JSON of the signed-in user, absent for anonymous requests) and `hostname`
(or `nginx-hostname` behind nginx; its first label is the tenant
`subdomain`) — into the GraphQL context. A malformed `user` header is
treated as anonymous.

The API serves `GET /health` and a federated subgraph at `/graphql`
(Federation v2). Every type and operation carries the plugin prefix because
all plugins share one supergraph.

The gateway only composes plugins listed in its `ENABLED_PLUGINS`.

## UI loading

1. core-api `GET /get-frontend-plugins` returns `{ name: "subedei_ui", entry }`
   for each enabled plugin. `entry` is the registered `uiEntry`, or
   `https://plugins.erxes.io/<releaseVersion>/subedei_ui/remoteEntry.js`.
2. core-ui loads `subedei_ui/config` and reads the exported `CONFIG`.
3. core-ui routes `/<CONFIG.path>/*` to `subedei_ui/<CONFIG.name>`, rendering
   the page component `Subedei`. The page owns its `AppLayout`, sidebar and
   nested settings route `/subedei/settings`. CONFIG supplies a navigation
   group `defaultPath` and module paths relative to the host root, including the
   plugin prefix (for example, `subedei/records`, not just `records`). Sidebar
   links use a leading `/`; CONFIG paths do not. The host does not use
   the old `settingsNavigation` or navigation-group `content`/`subGroup` slots.
   Only `./config` and `./subedei` are baseline exposes; add optional widgets
   when there is actual functionality behind them.
4. The `hostShared` list in `ui/rspack.config.ts` — `react`, `react-dom`,
   `react-router`, `react-router-dom`, `@apollo/client`, `jotai`,
   `react-i18next`, `erxes-ui` and `ui-modules` — mirrors core-ui's
   `coreLibraries` singletons, so the page runs inside core-ui's router,
   ApolloProvider, i18n and design system with the user's auth cookie. The
   remote never bundles them.

core-ui in development also registers remotes it gets from
`/get-frontend-plugins`, so `pnpm dev:uis` in erxes plus `npm run dev:ui`
here is enough.

## Shared libraries

`erxes-ui` and `ui-modules` — plus `erxes-api-shared` on the platform stack —
are published to npm as `@erxes/ui`, `@erxes/ui-modules` and
`@erxes/api-shared` ([erxes/ui](https://github.com/erxes/ui),
[erxes/ui-modules](https://github.com/erxes/ui-modules),
[erxes/api-shared](https://github.com/erxes/api-shared)). This repo installs
them under the names erxes code imports, with npm aliases:

```jsonc
// ui/package.json
"erxes-ui":   "npm:@erxes/ui@3.3.4",
"ui-modules": "npm:@erxes/ui-modules@3.3.4"
```

```jsonc
// api/package.json (platform stack)
"erxes-api-shared": "npm:@erxes/api-shared@3.3.4"
```

Notes:

- For the platform stack, use Yarn 4+ if choosing Yarn (tested: 4.18.1).
  Published `@erxes/api-shared` has a `yarn: "please-use-pnpm"` engine field,
  which Yarn Classic rejects. Modern Yarn installs the package without
  disabling engine checks. Activate Yarn 4 using Corepack, or choose pnpm.

- The tested host baseline is **erxes 3.3.2**. Exact package pins are
  `@erxes/ui@3.3.4`, `@erxes/ui-modules@3.3.4`, and `@erxes/api-shared@3.3.4`.
  This shared-library patch cohort preserves the host contract.
  React and ReactDOM 18.3.1 constraints are generated automatically, including
  transitive peers. There is no automatic `latest` upgrade. Inspect published
  peers and exports, then run fresh external install, codegen, check, build
  and a host smoke test when changing the cohort.
- The cohort's `ui-modules` peer range accepts the exact `erxes-ui` alias.
  Do not dismiss peer conflicts or use `--legacy-peer-deps` to hide them. CI verifies the installed package versions and peer ranges.
- Platform projects constrain Sentry Node 10.76.2, OpenTelemetry API 1.9.1,
  instrumentation 0.220.0 and trace SDK 2.12.0 through root npm/pnpm overrides
  or Yarn resolutions. The published floating graph can select API 1.10,
  which violates the trace SDK's `<1.10` peer range. These constraints retain
  the tested graph with real peer checks enabled; they do not assert arbitrary
  future telemetry compatibility. Update the cohort together and rerun fresh
  strict pnpm, npm and Yarn 4 platform install/codegen/check/lint/build checks.
- Published export maps include compiled declarations and, for some UI
  exports, source fallbacks. External type-check/build tests are required;
  do not assume monorepo path aliases or private files are present.
- `CONFIG.platform` declares `3.3.2` for the host compatibility
  warning. It is advisory: core-ui can still load a remote outside that range.
  Validate the host release before deployment; this field does not enforce it.
- `requiredVersion: false` is intentional **host-only consumption**, not a
  promise of cross-version compatibility. Nx hosts may advertise workspace
  versions (e.g. `1.1.0`) rather than the public cohort version. A blanket
  strict npm range would reject such hosts without proving ABI compatibility.
  Keep all nine `hostShared` keys `singleton: true, import: false`: the remote
  provides no private fallback. CI checks emitted federation stats for no
  shared fallback/provider assets. The host must supply those same keys;
  unknown/different host releases need explicit validation, not a bundled copy.

## GraphQL types

`npm run codegen` prints the API's subgraph SDL to
`api/generated/schema.graphql`, then `ui/codegen.ts` (graphql-codegen client
preset) validates every `gql()` document under `ui/src` against it and
generates typed documents into `ui/src/gql/` (gitignored, like
`api/generated`). Import `gql` from `~/gql` and let Apollo hooks infer their
types — drift between the SDL and the UI fails `check` instead of surfacing
as a runtime Apollo error. The same pattern backs erxes's own `operation`
plugin.

## Styling

core-ui ships Tailwind preflight and unprefixed utilities for its own code.
This remote compiles its own utilities with the `subedei:` prefix
(`ui/src/styles.css`), mapped to the host's design tokens (`--background`,
`--muted-foreground`, …). The prefix keeps the plugin's CSS from overriding
the host or other plugins. `erxes-ui` components come pre-styled by the host's
own CSS — no extra setup needed.

## Permissions

core-ui guards the route with `hasPluginPermission(CONFIG.name)`, which only
restricts plugins that core-api lists in `pluginsWithPermissions`, i.e. plugins
whose registered `meta.permissions` declares modules or default groups.
The registered API permission plugin and `CONFIG.name` both use `subedei`,
including dashes. The normalized container `subedei_ui` is only a loading key;
it must never replace that public permission identity.
Enforce access in the API resolvers, never only in the UI.

On the platform stack, `api/src/permissions.ts` declares
`subedeiSamplesRead` and `main.ts` registers it as `meta.permissions`.
The sample list requires a user, a tenant and `await checkPermission(action)`
before reading `context.models.Samples`. An administrator must grant the
sample module's read action with `all` scope (or use an owner account). There
are no automatic default grants. `all` means this tenant only: the model
factory selects the tenant's database. The example deliberately does not
advertise own/group scopes without implementing corresponding row filters.

The sample query accepts `limit` (default 20, range 1–100) and `offset`
(default 0, range 0–10000), applies both in Mongo and sorts by `createdAt` and
`_id`. The platform UI shows loading, denied/error, empty and paginated states.
The status query is a diagnostic and does not read sample data. Standalone
frameworks provide only the diagnostic query; add real authorization before
adding application data.

## Trusted gateway boundary

Both `startPlugin` and the standalone `api/src/context.ts` consume forwarded
`user` (base64 JSON) and `hostname`/`nginx-hostname` tenant headers. Base64 is
not a signature. A well-formed header can assert any identity if a caller can
reach the API directly; parsing it is not independent authentication.

- Keep API ports on a private network reachable only by the trusted gateway
  (and controlled health/introspection infrastructure). Do not publish the
  subgraph directly to the internet. Local development is trusted-local only.
- At public ingress, strip client-supplied `user`, `hostname` and
  `nginx-hostname`; configure the platform to forward its authenticated user
  and validated tenant host. Do not allow clients to override those assertions.
- A malformed standalone user header becomes anonymous. A well-formed one is
  trusted only because of this network boundary. Resolvers must still enforce
  login, permissions and tenant-scoped access.

## Production deployment

Install and retain the generated lockfile before the API Docker build. Supply
MongoDB (platform stack), Redis and gateway addressing through deployment
environment variables. Redis must be the same service/database erxes uses.
The API address (`LOAD_BALANCER_ADDRESS` or `plugin-subedei-api:<port>`) must be
reachable by the gateway; it is not the UI address. Production registration
must keep the router-update BullMQ job so the gateway recomposes.

Build the UI and upload **all** of `ui/dist`, not just `remoteEntry.js`, to your
static host. Set API `UI_ENTRY_URL` to the browser-reachable HTTPS URL ending in
`remoteEntry.js`. Enable CORS for the erxes UI origin. Upload chunks first and
the entry last; serve `remoteEntry.js` and federation manifests with no-store
or revalidation. Cache only content-hashed assets immutably. Preserve old
chunks during rollout so existing sessions can finish loading. The API Docker
image does not serve the UI. The plugins.erxes.io fallback is not a publishing
service: this generator does not upload your plugin there.
