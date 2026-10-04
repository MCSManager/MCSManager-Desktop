# MCSManager Desktop — Design Spec

Date: 2026-10-04
Status: Approved (unattended mode — autonomous decisions recorded in "Assumptions")
Target repo root: `C:\Workspace\MCSM-Desktop\MCSManager-Desktop`

## 1. Overview

MCSManager Desktop is a Windows desktop application (Tauri v2 + React 19 + TypeScript)
that acts as a launcher and control panel for a self-hosted MCSManager deployment.
It manages the two MCSManager services — **panel** (web) and **daemon** — as child
processes: start, stop, and tail their real-time console output. When the panel is up,
the user can switch to an embedded browser tab that renders the panel web UI
(default `http://localhost:23333`) so the web app feels like a native desktop app.

### Goals

1. Beautiful dark-themed control panel with per-service cards, live console output,
   and one-click start/stop for both services.
2. Tabbed main window: **Dashboard** and **Panel** (browser mode). Panel URL is read
   from the config file (default `http://localhost:23333`).
3. English-only code (comments and identifiers); all user-facing copy goes through
   i18n with an EN/中文 switcher in the top-right corner (default: English).
4. High reuse and low coupling: one generic Rust process manager drives both
   services; the frontend service card component is shared; Tauri access is isolated
   behind one injectable bridge.
5. Verifiable: unit tests for complex modules, integration tests for full flows,
   test-driven development (red → green → refactor).

### Non-goals (YAGNI)

- Building MCSManager from source (the app targets an already-built deployment).
- Managing MCSManager instances/servers (that is the panel web UI's job).
- Multi-node / remote daemon orchestration.
- Auto-update, system tray, global hotkeys.
- Linux/macOS polish (code stays portable, but only Windows is validated).

## 2. Domain facts (from MCSManager research)

- MCSManager is an npm-workspaces TypeScript monorepo (`panel/`, `daemon/`, `frontend/`, `common/`).
- Production build (`build.bat`, `BUNDLE=1`) emits a self-contained layout:

  ```
  production-code/
  ├── daemon/    # cwd for daemon; entry: node app.js
  └── web/       # cwd for panel;  entry: node app.js
  ```

- Dev layout runs `node production/app.js` with cwd `panel/` and `daemon/`.
- Entry points: `panel/src/app.ts`, `daemon/src/app.ts`. Both are long-running
  Node processes logging to stdout via log4js (`[MM/dd hh:mm:ss] [LEVEL] message`).
- Default ports: panel HTTP **23333**, panel data 23334, daemon **24444**.
- Graceful shutdown: Ctrl+C signals, **or writing `exit\n` to stdin** (both services
  parse stdin lines and call their soft-exit routine on `exit`). Daemon soft exit may
  wait up to ~30 s for instances.
- cwd matters: `data/`, `logs/`, `public/` resolve from `process.cwd()`. Panel
  auto-discovers a local daemon via `../daemon/data/Config/global.json`.
- Port-in-use failure prints `HTTP/Socket 服务启动错误，可能是端口被占用...` and exits (code 1).
- No `X-Frame-Options` / `frame-ancestors` headers anywhere → the panel web UI can be
  embedded in an `<iframe>`.

## 3. Requirements

### Functional

| ID | Requirement |
|----|-------------|
| F1 | Start / stop / restart the daemon and panel services independently. |
| F2 | Start-all (daemon first, then panel after a configurable delay) and stop-all. |
| F3 | Real-time stdout/stderr streaming per service into a console view (auto-scroll, clear, copy-all, pause-scroll). |
| F4 | Status model per service: `stopped / starting / running / stopping / error`, with PID, uptime, last exit code. |
| F5 | Readiness probe (TCP) per service; "Ready" indicator used to inform the user the panel URL is reachable. |
| F6 | Tab bar (top) switching Dashboard ⇄ Panel browser mode; browser loads the configured panel URL in an iframe with refresh + "open in external browser" actions. |
| F7 | Settings editor for: node executable path, per-service working dir / entry script / extra args / start delay / ready port, panel URL, stop timeout, max log lines. Persisted to a JSON config file; loaded on startup. |
| F8 | i18n EN/中文 switcher (top-right); default English; language persisted. |
| F9 | Errors surfaced in UI (spawn failure, missing working dir, non-zero exit, stop timeout) with actionable messages. |

### Non-functional

| ID | Requirement |
|----|-------------|
| N1 | All code (comments, identifiers, strings) in English; Chinese allowed only in locale/copy files (`src/i18n/locales/*.json`). Enforced by an automated test. |
| N2 | One reusable process manager drives both services (single implementation, two registrations). |
| N3 | Tauri APIs hidden behind one typed bridge module so UI logic is testable with a mock. |
| N4 | Unit tests for complex modules (Rust process manager, Rust config, TS i18n, TS console buffer, TS status reducer). |
| N5 | Integration tests for full user flows (start → stream → stop; tab switching; language switching; iframe URL from config). |
| N6 | `npm run lint`, `npm run typecheck`, `npm test`, `cargo test` all pass. |
| N7 | No console-window flashes on Windows when spawning children. |

## 4. Approaches considered

### Approach A — Custom Rust process manager + Tauri events + React dashboard *(chosen)*

Rust owns child processes (`std::process::Command`), a generic `ProcessManager`
registers N services, streams output through an injectable event sink (wired to
`app.emit` in production, to a test collector in tests). React UI subscribes to
Tauri events; iframe hosts the panel web UI.

- **Pros:** Full control of lifecycle (stdin `exit` grace → timeout → tree-kill);
  process manager unit-testable without the Tauri runtime (sink injection);
  shared manager satisfies reuse requirement; no heavyweight UI deps.
- **Cons:** More hand-written plumbing than a plugin; custom CSS instead of a
  component library.

### Approach B — `tauri-plugin-shell` + frontend-driven orchestration

Use the official shell plugin for spawn/kill/stdin and keep state machine in TS.

- **Pros:** Less Rust code; official plugin.
- **Cons:** Lifecycle semantics (graceful stop, exit-timeout fallback, no-window
  flag, line-splitting) scattered across JS; harder to unit-test without the Tauri
  runtime; weak fit for "one reusable manager" with clean state transitions.

### Approach C — Separate native `WebviewWindow` for the panel tab + Ant Design UI

Panel tab becomes a second Tauri window pointed at the panel URL; Ant Design for UI.

- **Pros:** Perfect web fidelity for the panel (native webview, no iframe).
- **Cons:** Not a tab switch (window juggling, worse UX than requested); heavy UI
  dependency tree; styling lock-in; larger bundle.

**Decision: Approach A.** It best matches the requirements (tab semantics, reusable
manager, testability, lean deps). iframe embedding is safe here because MCSManager
sets no frame-blocking headers.

## 5. Architecture

### 5.1 Rust backend (`src-tauri/src/`)

```
src-tauri/src/
├── main.rs               # binary entry; delegates to lib::run()
├── lib.rs                # Tauri builder: wires manager + sink + commands
├── commands.rs           # thin #[tauri::command] layer (UI-facing API)
├── config/
│   ├── mod.rs            # load/save config JSON in the app config dir
│   └── model.rs          # serde structs + defaults + validation
└── process/
    ├── mod.rs
    ├── events.rs         # ProcessEvent, ServiceState, ProcessSpec
    ├── managed.rs        # ManagedProcess: one child process lifecycle
    ├── manager.rs        # ProcessManager: registry of ManagedProcess
    └── platform.rs       # Windows no-window flag + process-tree kill helpers
```

Dependency direction: `commands → process/config`; `process` and `config` never
depend on Tauri types (the event sink is a plain `Arc<dyn Fn(ProcessEvent)>`).
This keeps complex modules unit-testable with `cargo test` and satisfies N2/N3.

#### ProcessSpec / ServiceConfig

```rust
pub struct ProcessSpec {
    pub id: String,            // "daemon" | "panel"
    pub display_name: String,
    pub command: String,       // node executable path
    pub args: Vec<String>,
    pub working_dir: String,
}
```

Built from `ServiceConfig { enabled, working_dir, script, extra_args, start_delay_ms, ready_port }`
plus the global `node_path`. Fixed arg order: `["--enable-source-maps",
"--max-old-space-size=8192", ...extra_args, script]`.
`display_name` is for logs and event payloads only; all UI-facing service labels
come from i18n keys (`service.daemon.name`, `service.panel.name`).

#### ManagedProcess state machine

```
Stopped ──start()──▶ Starting ──spawn ok──▶ Running ──stop()──▶ Stopping ──exit──▶ Stopped
   ▲                     │ spawn err           │ unexpected exit (code 0)              │
   │                     ▼                     ▼                                      │
   └────────────────── Error ◀── non-zero exit ───────────────────────────────────────┘
```

- `start()`: validate `working_dir` exists and `script` exists → spawn with piped
  stdout/stderr/stdin, `CREATE_NO_WINDOW` on Windows → reader threads split lines
  and forward `ProcessEvent::Output` → emit `ProcessEvent::Status(Running)`.
- `stop(timeout)`: write `exit\n` to stdin (MCSManager soft exit) → wait up to
  `stop_timeout_ms` → force-kill the process tree (`taskkill /PID <pid> /T /F` on
  Windows, `kill` elsewhere) → emit `Stopped` (or `Error` if it had failed).
- Unexpected exit: if exit code is `0` or `None` → `Stopped`, else → `Error` with
  the exit code captured for display.
- Output ring buffering is a frontend concern; Rust only forwards lines.

#### ProcessManager

- `register(spec)` / `unregister(id)` / `ids()`.
- `start(id)` / `stop(id)` / `start_all()` / `stop_all()` / `restart(id)`.
- `status(id) -> ServiceStatus` / `statuses() -> Vec<ServiceStatus>`.
- `start_all()`: starts services in registration order (daemon first), spawning the
  delayed starts on worker threads using `start_delay_ms`; both services reuse the
  exact same code path as individual starts.
- Thread-safety: services held in `Arc<Mutex<ManagedProcess>>`; reader threads only
  touch the child pipes and the sink.

#### Events (Tauri event names)

| Event | Payload |
|-------|---------|
| `service-status` | `{ id, state, pid?, startedAt?, exitCode?, error? }` |
| `service-output` | `{ id, stream: "stdout"\|"stderr", line, timestamp }` |
| `service-error` | `{ id, message }` |

The sink in `lib.rs` maps `ProcessEvent` → `app.emit(name, payload)`.

#### Commands (UI-facing)

| Command | Purpose |
|---------|---------|
| `get_config` / `save_config` | load / persist `AppConfig` (validated) |
| `get_service_statuses` | snapshot of all service statuses (for UI init) |
| `start_service(id)` / `stop_service(id)` / `restart_service(id)` | lifecycle |
| `start_all_services` / `stop_all_services` | batch lifecycle |
| `probe_tcp(host, port, timeoutMs)` | readiness check (used by F5) |
| `get_app_info` | app version + config file path (Settings footer) |

#### Config file

Location: `app_config_dir()/config.json` (Windows: `%APPDATA%/com.yumao.mcsmanager-desktop/config.json`),
created with defaults on first run.

```json
{
  "version": 1,
  "language": "en",
  "nodePath": "node",
  "panelUrl": "http://localhost:23333",
  "stopTimeoutMs": 35000,
  "maxLogLines": 2000,
  "services": {
    "daemon": { "enabled": true, "workingDir": "", "script": "app.js", "extraArgs": [], "startDelayMs": 0, "readyPort": 24444 },
    "panel":  { "enabled": true, "workingDir": "", "script": "app.js", "extraArgs": [], "startDelayMs": 1500, "readyPort": 23333 }
  }
}
```

Validation: `version` must be 1; `stopTimeoutMs` in 1000..=120000; `maxLogLines`
in 100..=20000; `panelUrl` must parse as `http(s)://`; `workingDir`, when set, must
exist; `language` ∈ {`en`, `zh`}. Unknown fields ignored (serde default), missing
fields defaulted — resilient to future migrations.

### 5.2 React frontend (`src/`)

```
src/
├── main.tsx
├── App.tsx                      # shell: TopBar + tab routing + Settings modal
├── types.ts                     # ServiceId, ServiceState, ServiceStatus, AppConfig…
├── i18n/
│   ├── index.tsx                # I18nProvider, useT(), language persistence
│   └── locales/{en.json, zh.json}
├── services/
│   └── bridge.ts                # sole Tauri seam: typed invoke + event subscribe
├── state/
│   ├── consoleBuffer.ts         # ring buffer (unit-tested)
│   └── serviceStore.ts          # status map + output buffers (unit-tested reducer)
├── hooks/
│   ├── useServices.ts           # store subscription + bridge wiring
│   ├── useConfig.ts             # config load/save state
│   └── useReadiness.ts          # periodic probe_tcp polling
├── components/
│   ├── layout/{TopBar, TabBar, LanguageSwitcher, Icon}.tsx
│   ├── dashboard/{Dashboard, ServiceCard, ConsolePanel, StatusBadge, ActionButton}.tsx
│   ├── browser/{BrowserTab}.tsx
│   └── settings/{SettingsModal, ServiceSettingsForm, NumberField, PathField}.tsx
├── styles/{tokens.css, global.css}
└── test/{setup.ts, mockBridge.ts, noChinese.test.ts}
```

State flow: bridge events → `serviceStore` reducer (pure functions, unit-tested) →
React via `useSyncExternalStore`. `bridge.ts` is the only module importing
`@tauri-apps/api`; integration tests inject a mock bridge.

### 5.3 UI design

- **Top bar:** app logo/title, tab pills (Dashboard | Panel), right cluster:
  language switcher (EN / 中文), settings icon, start-all / stop-all buttons.
- **Dashboard:** two reusable `ServiceCard`s (daemon, panel) — status badge,
  PID, uptime ticker, ready indicator, Start/Stop/Restart actions; each card
  expands to a `ConsolePanel` (monospace, ANSI-stripped lines, stream tinting,
  auto-scroll toggle, clear, copy). Card component is identical for both services
  (N2 at the UI layer).
- **Panel tab:** toolbar (URL display, refresh, open-external, readiness badge) +
  `<iframe src={panelUrl}>`. When the service is not ready, show an overlay with a
  "Start panel" shortcut and a retry note instead of a dead frame.
- **Settings modal:** sections — General (language, node path, panel URL, stop
  timeout, max log lines), Services (per-service working dir, script, extra args,
  start delay, ready port, enabled), About (version, config path).
- **Visual language:** dark theme with CSS custom-property tokens (surface /
  elevated / border / text / accent / success / warning / danger), 12–13 px UI
  type scale, subtle borders and shadows, green/amber/red status accents. All
  styling hand-rolled (no CSS framework) to keep dependencies lean.

### 5.4 i18n design (N1)

- Typed key maps: `en.json` is the source of truth; `zh.json` mirrors keys.
  `useT()` returns `t(key, vars?)` with `{name}` interpolation.
- Language default `en`; user choice persisted in localStorage **and** written to
  `config.language` on save.
- Test `noChinese.test.ts` scans `src/**/*.{ts,tsx,css}` and `src-tauri/src/**/*.rs`
  for CJK characters and fails if any appear outside `src/i18n/locales/`.

## 6. Error handling

| Failure | Behavior |
|---------|----------|
| Working dir / script missing | `start()` fails fast → `service-error` event → card shows error state + message (settings shortcut). |
| Node executable missing | Same as above (spawn error captured). |
| Port already in use | Process exits non-zero → `Error` state with exit code; console keeps the process's own error text visible. |
| Stop timeout | Force-kill fallback; status still resolves to `Stopped`; a warning line is injected into the console buffer. |
| Config file corrupt / invalid | Fall back to defaults, keep a backup copy (`config.json.bak`), surface a warning in Settings. |
| Panel URL unreachable | Browser tab overlay (F6) + readiness badge amber; never a crash. |
| Bridge failure (invoke rejected) | Toast-style inline error on the action that failed; state unchanged. |

All errors use user-facing i18n keys; raw error details go to the console panel.

## 7. Testing strategy (TDD)

Test-first order (each module: failing test → implement → refactor):

**Rust (`cargo test`, no Tauri runtime needed thanks to sink injection):**
1. `config/model` — defaults, serde round-trip, validation bounds, language enum.
2. `process/managed` — spawn a tiny Node script (`node -e "..."`):
   output lines forwarded with correct stream tags; state transitions
   stopped→starting→running→stopped; graceful stop via stdin `exit`;
   force-kill after timeout; non-zero exit → `Error` with exit code.
3. `process/manager` — registration, `start_all` ordering + delay, `stop_all`,
   status snapshots, unknown id errors.

**TypeScript (`vitest` + Testing Library, jsdom):**
4. `i18n` — default English, switch to zh, interpolation, fallback key behavior.
5. `consoleBuffer` / `serviceStore` — ring limit, stream tagging, reducer transitions.
6. `noChinese` guard test (N1).

**Integration (vitest, full `App` with `mockBridge`):**
7. Start-all flow: invoke calls made → status events update both cards →
   output events render in both consoles.
8. Stop flow + unexpected exit → error badge rendering.
9. Language switch flips visible copy EN→中文 without remounting services.
10. Tab switching; Panel tab iframe `src` equals configured `panelUrl`; overlay
    when service not running.
11. Settings round-trip: edit fields → save → bridge receives validated config.

## 8. Tooling

- `package.json` scripts: `dev`, `build`, `preview`, `tauri`, `typecheck`
  (`tsc --noEmit`), `lint` (ESLint 9 flat config + typescript-eslint), `format`
  (Prettier), `test` (vitest run), `test:watch`, `test:rust` (`cargo test` in
  `src-tauri`).
- devDependencies to add: `vitest`, `jsdom`, `@testing-library/react`,
  `@testing-library/dom`, `@testing-library/jest-dom`, `@testing-library/user-event`,
  `@types/node`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`,
  `prettier`.
- Window config: 1280×800 default (min 1024×680), title `MCSManager Desktop`.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| iframe blocked by future MCSManager headers | Toolbar "open in external browser" fallback; documented in README. |
| Daemon soft-stop exceeds timeout with instances running | `stopTimeoutMs` configurable (default 35 s); force-kill fallback; console warning. |
| Windows tree-kill orphans grandchildren | `taskkill /T /F` kills the tree; stdin `exit` is the primary path anyway. |
| Long-running output floods the UI | Frontend ring buffer (`maxLogLines`); line batching (coalesce events per animation frame). |
| Config schema drift | `version` field + tolerant serde defaults + backup on parse failure. |
| React 19 + Testing Library version friction | Pin `@testing-library/react` ≥ 16.1 (React 19 support). |

## 10. Assumptions (unattended decisions)

1. MCSManager is pre-built; this app only launches `node app.js` style entries.
   Building MCSManager is out of scope.
2. Deployment layout is identified by per-service `workingDir` + `script`
   (defaults `app.js`); this machine's dev checkout would set
   `script: "production/app.js"` — the user's config, not a hard-coded path.
3. Panel URL default `http://localhost:23333` as requested; readiness probe is a
   TCP connect (sufficient signal, no HTTP client dependency).
4. Dark theme only (visual polish focus); light theme is future work.
5. No git repository exists in the workspace; the design doc is written to the
   project tree but not committed (user has not requested version control).
6. "Browser window mode" is implemented as an in-window tab (iframe) per the
   literal "tab bar" requirement, not as a separate OS window.
