# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MCP server exposing SAP ABAP ADT (ABAP Development Tools) over the Model Context Protocol. Targets on-prem (ECC, S/4HANA), ABAP Cloud (BTP), and legacy (BASIS < 7.50) systems. Provides full CRUD for ABAP artifacts plus repository analysis tools. TypeScript, Node ≥ 22, ES modules (NodeNext).

## Build, Lint, Test

```bash
npm run build         # biome check --write (errors only) + tsc -p tsconfig.json
npm run build:fast    # tsc only (skip biome)
npm run lint          # biome check --write src   (auto-fix)
npm run lint:check    # biome check src           (CI-style, no writes)
npm run format        # biome format --write src
npm test              # jest — unit tests only (integration + admin excluded by default)
npm run test:check    # tsc --noEmit -p tsconfig.test.json (typecheck test sources)
```

Run a single test file:
```bash
npm test -- --testPathPatterns=<substring-of-path>
```

Note: Jest config in `package.json` sets `testPathIgnorePatterns: ['__tests__/admin/', '__tests__/integration/']`, so `npm test` only runs unit tests. Integration runs go through dedicated scripts (`test:integration`, `test:high`, `test:low`).

## Architecture (Big Picture)

The repo is the MCP-protocol adapter; the actual ABAP/HTTP work lives in sibling packages under `@mcp-abap-adt/*` on npm (`connection`, `adt-clients`, `auth-broker`, `auth-providers`, `auth-stores`, `interfaces`, `logger`, `header-validator`). Inter-package communication is interface-only — concrete types from sibling packages are not imported here. Architectural detail: `docs/architecture/ARCHITECTURE.md`.

**Composition root.** `src/server/launcher.ts` wires everything: parses CLI args, builds an `AuthBroker`, picks handler groups, picks a transport (`StdioServer`, `SseServer`, or `StreamableHttpServer`), and starts. `bin/mcp-abap-adt.js` is the user-facing entry that delegates to the launcher.

**Server hierarchy.**
- `BaseMcpServer` (extends `@modelcontextprotocol/sdk`'s `McpServer`) — owns connection context, registers tool handlers from a `CompositeHandlersRegistry`, filters them by `available_in` against the active `SapEnvironment`.
- `StdioServer` / `SseServer` / `StreamableHttpServer` — transport-specific subclasses.
- `EmbeddableMcpServer` — for hosting the MCP server inside another process (CAP/CDS, Express, etc.). Consumer supplies its own `AbapConnection`. See README "Embeddable Server" section.

**Handlers.** Live under `src/handlers/<object-type>/{readonly,high,low}/handle*.ts`. Every handler file exports two things:

- `TOOL_DEFINITION` — `{ name, description, available_in, inputSchema }`. `available_in` is a tuple like `['onprem', 'cloud', 'legacy'] as const`; omit it to expose everywhere. Filtered at registration time, not call time.
- `handle<Name>(context: HandlerContext, params)` — receives `{ connection, logger }` via `HandlerContext`; returns `{ content: [{ type: 'text', text: ... }] }`.

Handlers must not write files or hold state — they return structured results and rely on the injected `connection`.

**Handler groups** (`src/lib/handlers/groups/`): `ReadOnlyHandlersGroup`, `HighLevelHandlersGroup`, `LowLevelHandlersGroup`, `CompactHandlersGroup`, `SystemHandlersGroup`, `SearchHandlersGroup`. The launcher composes a `CompositeHandlersRegistry` from the groups selected by the active exposition (`--exposition` or config). Tiers in short:
- **readonly** — Get* / Read* / Where-Used / Search
- **high** — full workflow CRUD (`AdtClass.create()` handles validate → create → lock → update → unlock → activate internally)
- **low** — individual workflow steps exposed as separate tools (`ValidateX`, `CreateX`, `LockX`, `UpdateX`, `UnlockX`, `ActivateX`) for clients that want to drive the state machine themselves
- **compact** — condensed/aggregated tool surface
- **system / search** — orthogonal groupings

When adding a new handler: drop it under the right `<object-type>/<tier>/` folder, export `TOOL_DEFINITION` + `handle*`, and register it in the matching `*HandlersGroup.ts`.

**Transports & auth.** Stdio is for MCP clients (Claude Desktop, Cline, etc.). HTTP/SSE are for remote/embedded use. `--mcp=<destination>` selects a service key file from the platform sessions/service-keys directory (auth-broker). `--env=<name>` or `--env-path` selects a `.env` file. See README "Running the Server" for the full flag matrix.

## Conventions

- **English only** for source, comments, error messages, log messages, identifiers, and commit messages (`.cursor/rules/main.mdc`). User-facing chat follows whatever language the user is using.
- **Comments explain *why*, not *what***. Identifiers carry the *what*.
- Lint/format is **Biome** (`biome.json`), not ESLint/Prettier. Single quotes, semicolons, 2-space indent. `noExplicitAny` is a warning (off in tests).
- `husky` + `lint-staged` runs `biome check --write` on staged `src/**/*.{ts,js}`.

## Testing

### Integration Tests

Integration tests run against a real SAP system. Two modes:

- **Soft mode** (default, `integration_hard_mode.enabled: false`): calls handlers directly, no MCP subprocess.
- **Hard mode** (`integration_hard_mode.enabled: true`): spawns full MCP server via stdio, calls tools through MCP protocol.

**Strategy**: Run soft mode for mass regression testing. Use hard mode only for targeted verification of recent changes.

**Shared objects**: Before the first test run, create shared SAP objects (tables, CDS views, service definitions, classes) that some tests depend on:
```bash
npm run shared:setup     # first run only, persists across test runs
npm run shared:check     # verify they exist
```

**Important**: Shared object setup and SAP environment verification require collaboration with the user. Don't try to automate everything — run `shared:setup` once, show the result, and ask the user to verify activation in ADT. If activation fails, ask the user what they see rather than retrying blindly.

**Running integration tests**: Always save full output to a log file — do NOT truncate with `tail`. Tests take 15-25 minutes; use `timeout 1800` (30 min) or `run_in_background` with no timeout truncation. This avoids re-running long tests just to see errors.

```bash
# Soft mode (mass run) — save full log
npm run test:integration 2>&1 | tee /tmp/integration-test.log

# Hard mode (targeted, in test-config.yaml set integration_hard_mode.enabled: true)
npm test -- --testPathPatterns=<specific-test>
```

### Test Configuration

All test parameters live in `tests/test-config.yaml` (gitignored). The template (`tests/test-config.yaml.template`) works out of the box with sensible defaults.

**Setup:**
```bash
cp tests/test-config.yaml.template tests/test-config.yaml
# Edit ONLY the lines marked "# ← CHANGE"
```

**Required changes** (marked `# ← CHANGE`):
- `environment.env` — session .env file name (`"e19.env"`, `"mdd.env"`) from standard sessions folder
- `environment.system_type` — `"onprem"`, `"cloud"`, or `"legacy"`
- `environment.connection_type` — `"http"` (default) or `"rfc"`
- `environment.default_package` — dev package (`ZMCP_TEST`, `$TMP`)
- `environment.default_transport` — transport request or `""` for local packages
- `shared_dependencies.package` — package for shared test objects
- `shared_dependencies.software_component` — `"LOCAL"`, `"HOME"`, etc.

Test objects use the `ZMCP_BLD_*` naming convention (see template header). Everything else has working defaults. Full details: `docs/development/tests/TESTING_GUIDE.md`.

### available_in

`available_in` in `TOOL_DEFINITION` restricts a tool to specific SAP environments. If omitted, the tool is available everywhere. Only set it when a tool genuinely doesn't work on some platform (e.g., Programs are onprem-only):

```typescript
available_in: ['onprem', 'legacy'] as const,  // not available on cloud
```

Values: `'onprem'` | `'cloud'` | `'legacy'`. Test-level `available_in` is controlled separately in `test-config.yaml.template`.

### Cloud vs On-Prem

- Programs are NOT available on ABAP Cloud (`available_in: ['onprem', 'legacy']`)
- Runtime profiling (class-based) and dumps work on both cloud and onprem
- `RuntimeRunProgramWithProfiling` is onprem-only (no programs on cloud)

## npm Package Verification

When checking whether an installed npm package contains specific code, always search inside `node_modules/` directly (e.g., `grep -r "pattern" node_modules/@scope/package/`). VS Code search and ripgrep skip `node_modules` by default due to `.gitignore`, which leads to false "not found" conclusions. The code may be there — you're just not looking in the right place.

## Plans and Specs

Plans under `docs/superpowers/plans/` and specs under `docs/superpowers/specs/` are kept in the tree only while active — i.e. not yet implemented and not cancelled. Once a plan/spec has been fully implemented OR cancelled, delete the file. History lives in git; these directories hold only work in progress.
