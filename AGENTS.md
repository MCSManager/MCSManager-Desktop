# AGENTS.md

Guidance for AI agents (and new contributors) working in this repository.

## Project Overview

MCSManager Desktop is a Windows desktop shell for [MCSManager](https://github.com/MCSManager/MCSManager), built with **Tauri v2 (Rust)** and **React 19 + TypeScript**. It launches the MCSManager **daemon** and **panel** as child processes, streams their console output live, and embeds the panel web UI in an in-window tab (iframe). It does **not** manage MCSManager instances/servers — that is the panel web UI's job.

- The Rust backend owns child-process lifecycle: spawn, graceful stop (stdin `exit\n` → timeout → process-tree kill), status events, TCP readiness/port-conflict probes, config persistence, and the system tray.
- The React frontend renders a dark-themed dashboard (one reusable `ServiceCard` per service, console panel), a browser tab for the panel URL, and a settings modal. All user-facing copy goes through i18n (EN/中文).
- `daemon/` and `web/` are **pre-built MCSManager deployments** consumed at runtime (Node `app.js` entries). Never edit them as part of app work.

## Architecture (Big Picture)

### Data flow

```
React components (src/components)
        │ props / callbacks
     hooks (src/hooks: useConfig, useServices, useReadiness, useStartup)
        │ subscribe (useSyncExternalStore)
     pure stores (src/state: serviceStore, consoleBuffer, configStore)
        │ Bridge interface (src/services/bridge.ts — the ONLY module importing @tauri-apps/api)
        ▼
  Tauri invoke / events  ──── wire: camelCase JSON ────▶
        │                                                │
  commands.rs (thin #[tauri::command] layer)             │
        │                                                │
  ProcessManager + config (src-tauri/src/process,        │
  config — NO Tauri types; event sink = Arc<dyn Fn>)     │
        │                                                │
        └── ProcessEvent ── sink ──▶ app.emit ───────────┘
             (service-status / service-output / service-error)
```

Key ideas:

1. **Single seam.** `src/services/bridge.ts` defines the `Bridge` interface (invoke methods + `onStatus`/`onOutput`/`onError` subscriptions). UI code never imports `@tauri-apps/api` directly. Tests inject a mock bridge (`src/test/mockBridge.ts`) via `BridgeProvider`.
2. **Pure state.** Events land in `serviceStore`/`consoleBuffer` — framework-free reducers with unit tests. React reads them via `useSyncExternalStore`. `src/state/bridgeWiring.ts` connects a bridge to a store with ref-counted teardown.
3. **Tauri-free Rust core.** `src-tauri/src/process/` and `src-tauri/src/config/` never depend on Tauri types; output/status flow through an injectable event sink. This is what makes `cargo test` run without a Tauri runtime. `commands.rs` is the only layer that knows about both.
4. **One generic process manager.** A single `ProcessManager` registers both services (`ProcessSpec { id, display_name, command, args, working_dir }`); `ManagedProcess` implements the state machine `stopped → starting → running → stopping → stopped | error`.
5. **Fixed conventions on the wire:** all event/JSON payload fields are camelCase (`serde(rename_all = "camelCase")`); child args are always `["--enable-source-maps", "--max-old-space-size=8192", ...extraArgs, script]`.

### Directory map

```
src/                      # React frontend
├── App.tsx               # shell: providers, tab routing, startup orchestration
├── types.ts              # shared TS types (ServiceState, AppConfig, …)
├── components/           # layout/ dashboard/ browser/ settings/ dialogs/
├── hooks/                # useConfig, useServices, useReadiness, useStartup
├── state/                # serviceStore, consoleBuffer, configStore, bridgeWiring (pure)
├── services/             # bridge.ts (Tauri seam), portGate, portGuard, openExternal
├── i18n/                 # provider + locales/{en,zh}.json (source of truth: en.json)
├── styles/               # CSS tokens + global
└── test/                 # setup, mockBridge, guard tests, integration/
src-tauri/src/            # Rust backend
├── lib.rs                # Tauri builder: window, tray, localhost plugin, handler registration
├── commands.rs           # thin command layer + event sink
├── config/               # config model, validation, load/save (Tauri-free)
├── process/              # manager, managed, events, platform, net_port (Tauri-free)
└── tray/                 # system tray + localized strings
daemon/ web/              # pre-built MCSManager deployments — DO NOT EDIT
docs/superpowers/         # design specs + implementation plans (historical record)
.agents/skills/           # project-specific agent skills (e.g. building-windows-exe)
```

### Commands and events (contract)

Commands invoked from the frontend: `get_config`, `save_config`, `get_service_statuses`, `start_service`, `stop_service`, `restart_service`, `start_all_services`, `stop_all_services`, `probe_tcp`, `check_start_conflict`, `force_free_port`, `get_app_info`.

Every command registered in `lib.rs`'s `generate_handler![]` **must** be listed in `src-tauri/permissions/app.toml` (`commands.allow`), or `src/test/acl.test.ts` fails.

Events emitted to the frontend: `service-status`, `service-output`, `service-error`.

## Development Workflow (TDD)

**Test-driven development is mandatory.** Every feature, change, or bugfix follows red → green → refactor:

1. Write the failing test first (unit test for logic, integration test for user flows).
2. Run it and **observe it fail** — a test that never failed proves nothing.
3. Implement the minimum to make it pass.
4. Refactor with tests green. Never delete or weaken a test to make things pass.

### Test layers

| Layer                | Location                                       | Runner              | Scope                                               |
| -------------------- | ---------------------------------------------- | ------------------- | --------------------------------------------------- |
| Frontend unit        | Colocated `*.test.ts(x)` next to source        | `npm test`          | stores, buffers, hooks, services, i18n, components  |
| Frontend integration | `src/test/integration/*.test.tsx`              | `npm test`          | full `<App />` + `mockBridge` — complete user flows |
| Guard tests          | `src/test/{noChinese,acl,cjk}.test.ts`         | `npm test`          | policy enforcement (see below)                      |
| Rust unit            | Inline `#[cfg(test)] mod tests` in each module | `npm run test:rust` | config, process manager, commands, tray, net_port   |

Testing stack: Vitest + Testing Library + jsdom (`vitest.config.ts`, setup in `src/test/setup.ts`). Rust tests spawn tiny Node scripts (`node -e "..."`) to verify real process behavior — Node 22 must be on PATH.

Patterns:

- **Frontend:** render with `render(<App bridge={createMockBridge()} />)`; drive state via `mock.emitStatus(...)` / `mock.emitOutput(...)`; assert with `screen`/`waitFor`; assert invoke calls via `mock.calls`. Reset module stores (`resetConfigStore`, `resetServicesStore`) and `localStorage` in `beforeEach`/`afterEach`.
- **Rust:** construct `ProcessManager` with a collecting sink closure — no Tauri runtime needed. Prefer deterministic assertions on emitted events and state transitions.

### Guard tests (policy enforced by tests)

- `noChinese.test.ts` — code (comments, identifiers, strings, CSS) must be **English-only**; CJK characters allowed only in `src/i18n/locales/*.json` and docs.
- `acl.test.ts` — every command in `generate_handler!` must be allowed in `src-tauri/permissions/app.toml`.
- If you add a repo-wide rule, add a guard test for it.

## Code Style

- **TypeScript:** strict mode; no `any` without justification; prefer pure functions in `src/state/`. Components are PascalCase functions; hooks are `useX` and live in `src/hooks/`. Keep files focused — if one grows large, split it.
- **Formatting:** Prettier — double quotes, semicolons, `printWidth: 100`, trailing commas (`.prettierrc`). Run `npm run format` before committing; `format:check` must pass.
- **Lint:** ESLint flat config + `typescript-eslint` + `react-hooks` rules (`eslint.config.js`). No lint warnings/errors tolerated; use `npm run lint:fix` for mechanical fixes.
- **i18n:** all user-facing strings go through `useT()` with keys in `src/i18n/locales/en.json` (source of truth) mirrored in `zh.json`. Never hardcode display copy in components. Service display names in UI come from i18n keys, not from Rust.
- **Rust:** `std` only for the core (serde/serde_json already present — no new runtime deps without discussion); `process/` and `config/` must not import Tauri types; `commands.rs` stays a thin adapter. snake_case as usual; cargo fmt conventions.
- **Errors:** surface user-facing errors via i18n keys in the UI; raw details go to the console panel. Never crash on expected failures (missing files, port conflicts, unreachable panel) — degrade with a visible message.
- **Commits:** conventional prefixes used in this repo — `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:` (imperative subject, English).

## Verification (all must pass before claiming done)

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run format:check  # Prettier
npm test              # 17 files / 105+ tests, frontend unit + integration
npm run test:rust     # cargo test (87 tests), workdir-independent
```

Run the full set before finishing any task. CI (`.github/workflows/ci.yml`) runs exactly these commands on `windows-latest` for every push to `master` and every PR — a red CI means the work is not done.

Full app runs (optional, for manual verification): `npm run tauri dev`. Windows packaging: see `.agents/skills/building-windows-exe/SKILL.md`.

## Further Reading

- `README.zh-CN.md` / `README.md` — user-facing setup, config file location, service layout.
- `docs/superpowers/specs/2026-10-04-mcsmanager-desktop-design.md` — original design spec (requirements, state machine, error-handling table, testing strategy).
- `docs/superpowers/plans/2026-10-04-mcsmanager-desktop.md` — original implementation plan (task-by-task history).
- `.agents/skills/` — project skills (building Windows exe, updating app icon).
