# MCSManager Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. The human partner already selected subagent execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri v2 Windows desktop app that starts/stops the MCSManager panel and daemon processes, streams their console output live, and embeds the panel web UI in a tab — with i18n (EN/中文), full unit + integration tests.

**Architecture:** A generic Rust `ProcessManager` (Tauri-independent, event-sink injection) owns child process lifecycles; thin Tauri commands expose it to a React 19 dashboard. The dashboard reuses one `ServiceCard` for both services, buffers output through pure TS stores, and hosts the panel URL in an iframe tab. All copy flows through a typed i18n module; code stays English-only.

**Tech Stack:** Tauri 2.12, Rust 1.87 (std only), React 19, TypeScript 6 (strict), Vite 8, Vitest + Testing Library (jsdom), ESLint 9 + Prettier, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-10-04-mcsmanager-desktop-design.md`

All paths below are relative to `C:\Workspace\MCSM-Desktop\MCSManager-Desktop`.

## Global Constraints

- Code (comments, identifiers, literals) is English only; Chinese characters are allowed ONLY in `src/i18n/locales/*.json`. Enforced by `src/test/noChinese.test.ts` (Task 1).
- TypeScript strict mode; `npm run typecheck` must pass at every task end.
- TDD: every task writes the failing test first, runs it to see it fail, implements, re-runs green.
- Frontend tests: `npm test` (Vitest run). Rust tests: `cargo test` executed with workdir `src-tauri`.
- Commit steps are omitted everywhere: the workspace is not a git repository and version control was not requested. A task ends at its verification step.
- No new runtime dependencies beyond the scaffold and what Task 1 installs (dev-only). Rust side uses `std` only (serde/serde_json already present).
- Windows is the validation platform (Node 22.14 on PATH for Rust process tests).
- Event/JSON payload field names are camelCase on the wire (`serde(rename_all = "camelCase")`), matching the TS types in Task 8.
- Fixed child arg order for every service: `["--enable-source-maps", "--max-old-space-size=8192", ...extraArgs, script]`; graceful stop writes `exit\n` to stdin.

## Review Focus

1. **Daemon stop with instances running exceeds graceful window** — stop must resolve within `stopTimeoutMs` + 5 s kill grace and never hang; forced kill leaves no orphan tree. Pinned by `managed::stop_force_kills_after_timeout` (Task 4).
2. **Start while already running / double-start race** — second start returns `InvalidState` and never spawns a second child. Pinned by `managed::start_while_running_fails` and `manager::concurrent_start_is_safe` (Tasks 4, 5).
3. **Output flood overflow** — console buffer keeps exactly the last `maxLogLines` lines with strictly increasing ids and preserves stream tags. Pinned by `appendLine_respects_max_and_keeps_tail` (Task 8).
4. **Config round-trip loss** — `extraArgs`, `readyPort: null`, and unknown service keys survive save→load unchanged; corrupt files fall back to defaults with a `.bak` backup. Pinned by `round_trip_preserves_all_fields` and `load_recovers_from_corrupt_file` (Task 2).
5. **Panel tab against a down or reconfigured panel** — iframe `src` always equals `config.panelUrl`; when the service is not running an overlay offers "Start panel" instead of a dead frame; URL edits in Settings take effect without restart. Pinned by `browser_tab_renders_configured_url` and `browser_tab_shows_overlay_when_down` (Tasks 11, 13).

---

### Task 1: Tooling baseline + CJK guard

**Files:**
- Modify: `package.json` (scripts + devDependencies), `vite.config.ts` untouched
- Create: `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `src/test/setup.ts`, `src/test/cjk.ts`, `src/test/noChinese.test.ts`, `src/test/cjk.test.ts`

**Interfaces:**
- Consumes: none (first task).
- Produces: `containsCjk(text: string): boolean` in `src/test/cjk.ts`; npm scripts `typecheck`, `lint`, `format`, `format:check`, `test`, `test:watch`, `test:rust` usable by every later task.

- [ ] **Step 1: Write failing tests for the CJK detector and the source scan**

`src/test/cjk.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { containsCjk } from "./cjk";

describe("containsCjk", () => {
  it("detects Chinese characters", () => {
    expect(containsCjk("启动面板")).toBe(true);
    expect(containsCjk("start 面板")).toBe(true);
  });
  it("passes English and symbols", () => {
    expect(containsCjk("Start panel")).toBe(false);
    expect(containsCjk("\\u4e00 escaped")).toBe(false);
    expect(containsCjk("")).toBe(false);
  });
});
```

`src/test/noChinese.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { containsCjk } from "./cjk";

// walks src/ and src-tauri/src/ recursively (node:fs), skipping src/i18n/locales/
describe("no Chinese in code", () => {
  it("has no CJK characters in code files outside locale files", () => {
    const offenders: string[] = collectCodeFiles(/* ... */).filter((f) => containsCjk(read(f)));
    expect(offenders).toEqual([]);
  });
});
```
Implement `collectCodeFiles` inside the test file: recursive `readdirSync`, include extensions `.ts .tsx .css .rs`, exclude any path containing `src/i18n/locales`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `vitest: command not found` / no test script (setup missing).

- [ ] **Step 3: Install dev tooling and add configs + scripts**

Run: `npm i -D vitest jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event @types/node eslint @eslint/js typescript-eslint eslint-plugin-react-hooks prettier`

- `vitest.config.ts`: `defineConfig` from `vitest/config`, `plugins: [react()]`, `test: { environment: "jsdom", setupFiles: "./src/test/setup.ts", include: ["src/**/*.test.{ts,tsx}"] }`.
- `src/test/setup.ts`: `import "@testing-library/jest-dom/vitest";`
- `eslint.config.js`: flat config — `js.configs.recommended`, `tseslint.configs.recommended`, `react-hooks` recommended rules, ignores `dist/`, `src-tauri/`, `node_modules/`.
- `.prettierrc`: `{ "semi": true, "singleQuote": false, "printWidth": 100, "trailingComma": "all" }` (matches template style).
- `package.json` scripts: `"typecheck": "tsc --noEmit"`, `"lint": "eslint ."`, `"lint:fix": "eslint . --fix"`, `"format": "prettier --write ."`, `"format:check": "prettier --check ."`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:rust": "cargo test --manifest-path src-tauri/Cargo.toml"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → both CJK tests PASS. Run `npm run typecheck` → clean. Run `npm run lint` → clean (fix any template lint issues, e.g. unused imports in `App.tsx`).

### Task 2: Rust config model

**Files:**
- Create: `src-tauri/src/config/mod.rs`, `src-tauri/src/config/model.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod config;` only; wiring comes in Task 6)

**Interfaces:**
- Consumes: none.
- Produces (used by Tasks 4–6, 8, 12):
  - `Language { En, Zh }` — serde lowercase `"en"`/`"zh"`; `Default = En`.
  - `ServiceConfig { enabled: bool, working_dir: String, script: String, extra_args: Vec<String>, start_delay_ms: u64, ready_port: Option<u16> }` (serde camelCase, `#[serde(default)]`).
  - `AppConfig { version: u32, language: Language, node_path: String, panel_url: String, stop_timeout_ms: u64, max_log_lines: usize, services: BTreeMap<String, ServiceConfig> }` (serde camelCase).
  - `AppConfig::default()`: version `1`, language `En`, node_path `"node"`, panel_url `"http://localhost:23333"`, stop_timeout_ms `35000`, max_log_lines `2000`, services map with keys `"daemon"` (`start_delay_ms: 0`, `ready_port: Some(24444)`) and `"panel"` (`start_delay_ms: 1500`, `ready_port: Some(23333)`); both `{ enabled: true, working_dir: "", script: "app.js", extra_args: [] }`.
  - `AppConfig::validate(&self) -> Result<(), ConfigError>` — structural only: `version == 1`; `stop_timeout_ms` in `1000..=120000`; `max_log_lines` in `100..=20000`; `panel_url` parses with `url::Url`? **No extra deps** — check `starts_with("http://") || starts_with("https://")`; `services` contains at least `"panel"` and `"daemon"`.
  - `AppConfig::path_issues(&self) -> Vec<String>` — fs warnings: non-empty `working_dir` that is not an existing directory, `script` (joined under working_dir) not an existing file. Warning strings are English (surfaced via Settings footer, not i18n keys).
  - `ServiceConfig::command_and_args(&self, node_path: &str) -> (String, Vec<String>)` — returns `(node_path.to_owned(), ["--enable-source-maps", "--max-old-space-size=8192", ...extra_args, script])`. Building a full `ProcessSpec` is Task 6's job (keeps `config` free of `process` imports).
  - `config::LoadOutcome { config: AppConfig, recovered: bool, error: Option<String> }`
  - `config::load_from(path: &Path) -> Result<LoadOutcome, ConfigError>` — missing file → `Ok(default, recovered=false)`; parse or validate failure → copy file to `config.json.bak` beside it, return defaults with `recovered=true` and `error` message.
  - `config::save_to(path: &Path, config: &AppConfig) -> Result<(), ConfigError>` — calls `validate()` first; creates parent dirs.
  - `ConfigError { Io(String), Invalid(String) }` with `Display` + `std::error::Error`.

- [ ] **Step 1: Write failing tests** in `src-tauri/src/config/mod.rs` (`#[cfg(test)] mod tests`) using `std::env::temp_dir()`-based paths:

```rust
#[test] fn default_matches_spec_values()            // assert every default field value listed above
#[test] fn round_trip_preserves_all_fields()         // set extra_args=["production/app.js"], ready_port=None, save_to, load_from, assert eq
#[test] fn validate_rejects_bad_values()             // bad url "ftp://x", stop_timeout_ms 0, max_log_lines 50, missing panel key -> Invalid(_)
#[test] fn load_recovers_from_corrupt_file()         // write "{not json", load_from -> recovered=true, config == default, .bak exists
#[test] fn load_missing_file_returns_default()       // recovered=false
#[test] fn command_and_args_orders_args()            // args == ["--enable-source-maps","--max-old-space-size=8192","production/app.js"]
#[test] fn path_issues_reports_missing_dir()         // working_dir set to temp non-existent -> 1+ warnings
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test` (workdir `src-tauri`) — Expected: compile error `config` not found.

- [ ] **Step 3: Implement `config/model.rs` + `config/mod.rs`** per the Interfaces block; add `mod config;` to `lib.rs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test` (workdir `src-tauri`) — Expected: all config tests PASS.

### Task 3: Rust process events + platform helpers

**Files:**
- Create: `src-tauri/src/process/mod.rs`, `src-tauri/src/process/events.rs`, `src-tauri/src/process/platform.rs`
- Modify: none

**Interfaces:**
- Consumes: none (config keeps no `process` imports; Task 6 joins them).
- Produces (used by Tasks 4–6):
  - `events.rs` (exact):
    - `pub type EventSink = Arc<dyn Fn(ProcessEvent) + Send + Sync>;`
    - `ServiceState { Stopped, Starting, Running, Stopping, Error }` — serde camelCase variants.
    - `ServiceStatus { id: String, state: ServiceState, pid: Option<u32>, started_at: Option<u64>, exit_code: Option<i32>, error: Option<String> }` — serde camelCase; `timestamp` values are unix millis.
    - `OutputStream { Stdout, Stderr }` — serde lowercase.
    - `ProcessEvent { Status(ServiceStatus), Output { id: String, stream: OutputStream, line: String, timestamp: u64 }, Error { id: String, message: String } }` (internal enum, no serde needed).
    - `ProcessSpec { id: String, display_name: String, command: String, args: Vec<String>, working_dir: String, start_delay_ms: u64 }` — derive `Debug, Clone, PartialEq, Eq`.
  - `platform.rs`:
    - `pub fn configure_command(cmd: &mut std::process::Command)` — applies `CREATE_NO_WINDOW` (0x08000000) via `std::os::windows::process::CommandExt::creation_flags` under `#[cfg(windows)]`; no-op elsewhere.
    - `pub fn kill_tree(pid: u32)` — Windows: `Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"])` (with `configure_command`); other: `Command::new("kill").args(["-9", &pid.to_string()])`. Fire-and-forget; ignores failure.
    - `pub fn now_millis() -> u64` — unix epoch millis.

- [ ] **Step 1: Write failing tests** in `src-tauri/src/process/platform.rs` and `src-tauri/src/process/events.rs` test modules:

```rust
#[test] fn now_millis_is_recent()                    // within 5s of SystemTime::now
#[test] fn kill_tree_ignores_unknown_pid()           // kill_tree(0) or 4_000_000_000 does not panic
#[test] fn configure_command_does_not_panic()        // on a fresh Command
#[test] fn service_status_serializes_camel_case()    // serde_json::to_value -> keys "id","state","pid","startedAt","exitCode","error"; state "running"
#[test] fn output_stream_serializes_lowercase()      // "stdout" / "stderr"
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: compile error (module missing).

- [ ] **Step 3: Implement `events.rs` + `platform.rs`** exactly per Interfaces (`pub mod events; pub mod platform;` in `mod.rs`).

- [ ] **Step 4: Run tests to verify they pass** — `cargo test` green.

### Task 4: Rust ManagedProcess (core lifecycle)

**Files:**
- Create: `src-tauri/src/process/managed.rs`
- Modify: `src-tauri/src/process/mod.rs` (`pub mod managed;`)

**Interfaces:**
- Consumes: Task 2/3 types (`ProcessSpec`, `ProcessEvent`, `ServiceState`, `ServiceStatus`, `EventSink`, `platform::*`).
- Produces (used by Tasks 5–6):
  - `ProcessError { NotFound(String), Duplicate(String), InvalidState(String), Spawn(String), Io(String) }` with `Display` + `Error`; declared in `managed.rs`.
  - `ManagedProcess::new(spec: ProcessSpec, sink: EventSink, stop_timeout: Duration) -> Self`
  - `ManagedProcess::id(&self) -> &str`
  - `ManagedProcess::status(&self) -> ServiceStatus` (reads shared `ProcState`; never blocks on the child).
  - `ManagedProcess::start(&mut self) -> Result<(), ProcessError>` — `InvalidState` if already `Starting/Running/Stopping`; validates `working_dir` is an existing dir and `script` (last arg) is an existing file inside it, else `Spawn("...")` with English message; spawns child with piped stdio via `platform::configure_command`; takes `stdin/stdout/stderr`; starts 2 reader threads (split on `\n`, trim `\r`) emitting `ProcessEvent::Output` with `platform::now_millis()`; starts 1 supervisor thread owning `Child` that `wait()`s and on exit sets shared state (`stop_requested` → `Stopped`; else exit code 0/`None` → `Stopped`, else `Error` with `exit_code`) and emits `ProcessEvent::Status`. Emits `Starting` then `Running` status events.
  - `ManagedProcess::stop(&mut self) -> Result<(), ProcessError>` — no-op `Ok` when `Stopped`/`Error`; otherwise set `stop_requested`, state `Stopping` (emit), write `exit\n` to stdin (ignore write errors), poll shared state up to `stop_timeout`; on timeout call `platform::kill_tree(pid)` and poll up to 5 s more; final state comes from the supervisor thread; returns `Ok` even after force-kill (emit a synthetic console line via `ProcessEvent::Output` with text `"Stop timeout exceeded; process tree was force-killed."`).
  - Shared internals: `Arc<Mutex<ProcState>>` with `ProcState { state, pid, started_at, exit_code, error, stop_requested }` — status reads use this so they never wait on the lifecycle mutex.

- [ ] **Step 1: Write failing tests** in `managed.rs` tests module (use `node` with `-e` scripts; `sink` collects `ProcessEvent` into `Arc<Mutex<Vec<ProcessEvent>>>`):

```rust
#[test] fn start_streams_stdout_lines()             // node -e "console.log('hello-1'); setInterval(()=>{},1e3)" -> Output line contains "hello-1", state Running, pid Some
#[test] fn start_while_running_fails()              // second start -> Err(InvalidState(_)); still exactly one Output of 'hello-1'
#[test] fn graceful_stop_uses_stdin_exit()          // node -e "process.stdin.on('data',()=>process.exit(0)); console.log('ready')" -> stop() resolves < 2s, final state Stopped
#[test] fn stop_force_kills_after_timeout()         // node -e "setInterval(()=>{},1e3)" (ignores stdin), stop_timeout 300ms -> stop() < 8s, final Stopped, sink saw the force-kill message
#[test] fn unexpected_nonzero_exit_is_error()       // node -e "process.exit(3)" -> state Error, exit_code Some(3)
#[test] fn start_with_missing_workdir_fails()       // working_dir "C:/definitely/not/here" -> Err(Spawn(_)), no panic
#[test] fn stop_when_stopped_is_noop()              // stop() before start / after exit -> Ok
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: compile error `managed` not found.

- [ ] **Step 3: Implement `ManagedProcess`** per Interfaces (supervisor thread owns `Child`; reader threads own pipe handles; `ProcState` shared for lock-free status queries).

- [ ] **Step 4: Run tests to verify they pass** — `cargo test` green (suite should finish < 30 s).

### Task 5: Rust ProcessManager (registry + batch ops)

**Files:**
- Create: `src-tauri/src/process/manager.rs`
- Modify: `src-tauri/src/process/mod.rs` (`pub mod manager;`)

**Interfaces:**
- Consumes: `ManagedProcess`, `ProcessError`, `EventSink`.
- Produces (used by Task 6):
  - `ProcessManager::new(sink: EventSink, stop_timeout: Duration) -> Self`
  - `register(&mut self, spec: ProcessSpec) -> Result<(), ProcessError>` — `Duplicate` on existing id.
  - `start(&self, id: &str) -> Result<(), ProcessError>` / `stop(&self, id: &str) -> Result<(), ProcessError>` / `restart(&self, id: &str) -> Result<(), ProcessError>` — `NotFound` for unknown id; each runs against `Arc<Mutex<ManagedProcess>>` so different services don't block each other; `status()` uses the shared `ProcState` clones so it never waits on lifecycle locks.
  - `start_all(&self) -> Result<(), ProcessError>` — starts enabled services in registration order; any service with `start_delay_ms > 0` is scheduled on a `std::thread` that sleeps then starts; returns after the first (delay-0) starts are initiated; spawn order of `Starting` events is registration order.
  - `stop_all(&self) -> Result<(), ProcessError>` — stops all, in reverse registration order, sequentially.
  - `status(&self, id: &str) -> Result<ServiceStatus, ProcessError>` / `statuses(&self) -> Vec<ServiceStatus>` (registration order).
  - `shutdown(&self)` — `stop_all()` ignoring errors (used on app exit).
  - `start_all` reads `spec.start_delay_ms` (already part of `ProcessSpec` from Task 3); `register` stores the spec (including the delay) with the managed process.

- [ ] **Step 1: Write failing tests** in `manager.rs` tests (reuse node dummy scripts; sink records order of `Status` events):

```rust
#[test] fn register_and_status_roundtrip()           // register -> status() == Stopped with id
#[test] fn duplicate_register_fails()                // second register same id -> Err(Duplicate(_))
#[test] fn unknown_id_errors()                       // start("nope") -> Err(NotFound(_))
#[test] fn start_all_respects_registration_order()   // two services delay 0 and 200ms -> Running order == [first, second], both within 2s
#[test] fn stop_all_stops_everything()               // start both -> stop_all -> both Stopped within 8s
#[test] fn restart_replaces_process()                // start -> restart -> new pid != old pid (or single Running), old gone
#[test] fn concurrent_start_is_safe()                // 4 threads call start(id) -> exactly 1 Ok, others Err(_), one child
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: compile error `manager` not found.

- [ ] **Step 3: Implement `ProcessManager`** per Interfaces; `ManagedProcess` stored as `Arc<Mutex<ManagedProcess>>` in `HashMap` preserving insertion order (keep a `Vec<String>` order list); a second `HashMap<String, Arc<Mutex<ProcState>>>` for lock-light status reads.

- [ ] **Step 4: Run tests to verify they pass** — `cargo test` green.

### Task 6: Tauri wiring — commands, events, window config

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`
- Test: `src-tauri/src/commands.rs` (`#[cfg(test)]` for `probe_tcp` only)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces (frontend contract — mirror in Task 8 `src/types.ts`):
  - Events emitted via `app.emit`: `service-status` (payload `ServiceStatus`), `service-output` (`{ id, stream, line, timestamp }`), `service-error` (`{ id, message }`).
  - Commands (all `Result<_, String>` error strings, English):
    - `get_config() -> ConfigResponse { config: AppConfig, warnings: Vec<String> }` (warnings = `path_issues()`).
    - `save_config(config: AppConfig) -> ()` (validates; persists to config path). **Decision: `start_service` builds `ProcessSpec` from the *current* config at call time** (`ServiceConfig::command_and_args(node_path)` + `working_dir`/`start_delay_ms`, `display_name = id`) and (re)registers it, so Settings changes apply without app restart.
    - `get_service_statuses() -> Vec<ServiceStatus>`
    - `start_service(id: String)` / `stop_service(id: String)` / `restart_service(id: String)` / `start_all_services()` / `stop_all_services()` — async, run manager calls via `tauri::async_runtime::spawn_blocking` on cloned `Arc<Mutex<ProcessManager>>`.
    - `probe_tcp(host: String, port: u16, timeout_ms: u64) -> bool` — `TcpStream::connect_timeout`.
    - `get_app_info() -> AppInfo { version: String, config_path: String }` (from `CARGO_PKG_VERSION` and app config dir).
  - `AppState { manager: Arc<Mutex<ProcessManager>>, config: Arc<Mutex<AppConfig>>, config_path: PathBuf }` managed by Tauri.
- `tauri.conf.json`: window `{ title: "MCSManager Desktop", width: 1280, height: 800, minWidth: 1024, minHeight: 680 }`.
- `lib.rs` `run()`: compute config path (`app_handle.path().app_config_dir()/config.json`), `load_from`, build `ProcessManager` with `EventSink` emitting the three events (`serde` payloads camelCase), register `ProcessSpec`s for enabled services (built exactly as `start_service` does), manage `AppState`, register all commands, and on window `Destroyed` call `manager.shutdown()`.

- [ ] **Step 1: Write failing test** for `probe_tcp` in `commands.rs`:

```rust
#[test] fn probe_tcp_detects_open_port()   // bind TcpListener 127.0.0.1:0 -> probe_tcp true
#[test] fn probe_tcp_detects_closed_port() // probe a just-dropped port -> false
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: compile error `commands` not found.

- [ ] **Step 3: Implement `commands.rs`, wire `lib.rs`, update `tauri.conf.json`** per Interfaces. Keep command bodies one-liners delegating to manager/config (thin layer, no logic).

- [ ] **Step 4: Verify**

Run: `cargo test` (workdir `src-tauri`) → green; then `cargo check` (workdir `src-tauri`) → clean compile of the Tauri builder.

### Task 7: TS i18n module + locales

**Files:**
- Create: `src/i18n/index.tsx`, `src/i18n/locales/en.json`, `src/i18n/locales/zh.json`, `src/i18n/i18n.test.tsx`
- Modify: none

**Interfaces:**
- Consumes: none.
- Produces (used by every UI task):
  - `type Language = "en" | "zh"`.
  - `I18nProvider({ children, initialLanguage? }: { children: ReactNode; initialLanguage?: Language })` — default language `en`; persists choice in `localStorage["mcsm-desktop.lang"]`.
  - `useI18n(): { language: Language; setLanguage(l: Language): void; t(key: string, vars?: Record<string, string | number>): string }`.
  - `t` behavior: lookup key in active locale; missing → fall back to `en` locale; missing there → return the key itself. Interpolation replaces `{name}` with `vars.name`.
  - Locale keys (initial set — extend freely in UI tasks, adding to BOTH files):
    `app.title`, `tab.dashboard`, `tab.panel`, `language.en`, `language.zh` (values `"English"` / `"中文"` in both files),
    `service.daemon.name`, `service.panel.name`, `state.stopped|starting|running|stopping|error`,
    `action.start`, `action.stop`, `action.restart`, `action.startAll`, `action.stopAll`,
    `console.title`, `console.clear`, `console.copy`, `console.autoScroll`, `console.copied`,
    `status.pid`, `status.uptime`, `status.ready`, `status.notReady`, `status.exitCode`,
    `browser.refresh`, `browser.openExternal`, `browser.notRunning.title`, `browser.notRunning.hint`,
    `settings.title`, `settings.general`, `settings.services`, `settings.nodePath`, `settings.panelUrl`,
    `settings.stopTimeout`, `settings.maxLogLines`, `settings.workingDir`, `settings.script`,
    `settings.extraArgs`, `settings.startDelay`, `settings.readyPort`, `settings.enabled`,
    `settings.save`, `settings.close`, `settings.saved`, `settings.about`, `settings.configPath`,
    `error.startFailed`, `error.saveFailed`, `error.notConfigured`.
- TS mirrors (also produced here for Task 8 convenience — re-exported from `src/types.ts` in Task 8):
  `Language` values exactly `"en" | "zh"`.

- [ ] **Step 1: Write failing tests** in `src/i18n/i18n.test.tsx` (Testing Library):

```ts
it("defaults to English", ...)                  // render provider + probe component, expect "Start"
it("switches to Chinese", ...)                  // setLanguage("zh"), expect 启动
it("falls back to English for missing keys", ...) // zh missing key -> English value
it("returns key when missing everywhere", ...)  // t("nope.key") === "nope.key"
it("interpolates variables", ...)               // t("status.pid", { pid: 42 }) contains "42"
it("persists language choice", ...)             // setLanguage("zh") -> localStorage["mcsm-desktop.lang"] === "zh"
```
(Chinese expectations read the values from the imported `zh` JSON so the test file itself stays ASCII — or assert `t("action.start") === zh["action.start"]`. Use the JSON-import approach to keep N1 true everywhere.)

- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL, module missing.

- [ ] **Step 3: Implement `src/i18n/index.tsx` + both locale files** per Interfaces. Interpolation: `String(value)` into `{name}` placeholders.

- [ ] **Step 4: Verify** — `npm test` green; `npm run typecheck` clean; `npm run lint` clean.

### Task 8: TS types, bridge, stores, hooks

**Files:**
- Create: `src/types.ts`, `src/services/bridge.ts`, `src/state/consoleBuffer.ts`, `src/state/serviceStore.ts`, `src/hooks/useServices.ts`, `src/hooks/useConfig.ts`, `src/hooks/useReadiness.ts`, `src/test/mockBridge.ts`
- Test: `src/state/consoleBuffer.test.ts`, `src/state/serviceStore.test.ts`, `src/hooks/useServices.test.tsx`, `src/hooks/useReadiness.test.tsx`
- Modify: none

**Interfaces:**
- Consumes: Task 6 command/event contract (wire shapes), Task 7 `Language`.
- Produces (used by UI tasks 9–13):
  - `src/types.ts`:
    ```ts
    export type ServiceId = "daemon" | "panel";
    export type ServiceState = "stopped" | "starting" | "running" | "stopping" | "error";
    export type OutputStream = "stdout" | "stderr";
    export interface ServiceStatus { id: string; state: ServiceState; pid?: number; startedAt?: number; exitCode?: number; error?: string; }
    export interface OutputLine { id: string; stream: OutputStream; line: string; timestamp: number; }
    export interface ServiceConfig { enabled: boolean; workingDir: string; script: string; extraArgs: string[]; startDelayMs: number; readyPort: number | null; }
    export interface AppConfig { version: number; language: Language; nodePath: string; panelUrl: string; stopTimeoutMs: number; maxLogLines: number; services: Record<ServiceId, ServiceConfig>; }
    export interface ConfigResponse { config: AppConfig; warnings: string[]; }
    export interface AppInfo { version: string; configPath: string; }
    ```
  - `src/services/bridge.ts`:
    ```ts
    export interface Bridge {
      getConfig(): Promise<ConfigResponse>;
      saveConfig(config: AppConfig): Promise<void>;
      getStatuses(): Promise<ServiceStatus[]>;
      startService(id: string): Promise<void>;
      stopService(id: string): Promise<void>;
      restartService(id: string): Promise<void>;
      startAll(): Promise<void>;
      stopAll(): Promise<void>;
      probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean>;
      getAppInfo(): Promise<AppInfo>;
      onStatus(cb: (s: ServiceStatus) => void): () => void;
      onOutput(cb: (o: OutputLine) => void): () => void;
      onError(cb: (e: { id: string; message: string }) => void): () => void;
    }
    export const bridge: Bridge; // real impl: @tauri-apps/api invoke + listen; the ONLY module importing @tauri-apps/api
    ```
    `BridgeContext` + `BridgeProvider({ bridge, children })` + `useBridge()` live in this file too.
  - `src/state/consoleBuffer.ts` — pure functions:
    ```ts
    export interface ConsoleLine { id: number; stream: OutputStream; text: string; timestamp: number; }
    export function appendLine(state: ConsoleLine[], entry: { stream: OutputStream; text: string; timestamp: number }, maxLines: number): ConsoleLine[];
    export function clearLines(): ConsoleLine[];
    ```
    ids strictly increase (`(last?.id ?? 0) + 1`); when `length > maxLines`, keep the tail (drop from the front).
  - `src/state/serviceStore.ts`:
    ```ts
    export interface ServicesState { statuses: Record<string, ServiceStatus>; outputs: Record<string, ConsoleLine[]>; }
    export function createServicesStore(maxLines: number): {
      getState(): ServicesState;
      subscribe(cb: () => void): () => void;
      applyStatus(s: ServiceStatus): void;
      applyOutput(o: OutputLine): void;
      applyError(e: { id: string; message: string }): void; // appends a stderr ConsoleLine with e.message
      clearOutput(id: string): void;
    };
    ```
  - `src/hooks/useServices(maxLines = 2000)` returns `{ statuses, outputs, start, stop, restart, startAll, stopAll, clearOutput, actionError }` — subscribes to the store via `useSyncExternalStore`, wires `bridge.onStatus/onOutput/onError` once (unsubscribes on unmount, StrictMode-safe), `actionError` is the last rejected invoke message (cleared on next successful action).
  - `src/hooks/useConfig()` returns `{ config, warnings, saving, error, save, reload }`.
  - `src/hooks/useReadiness(host: string, port: number | null, enabled: boolean, intervalMs = 3000): boolean`.
  - `src/test/mockBridge.ts` — `createMockBridge(overrides?: Partial<Bridge>): MockBridge` where `MockBridge extends Bridge` adds `emitStatus`, `emitOutput`, `emitError`, `calls: { name: string; args: unknown[] }[]`, `config: AppConfig` (mutable fixture), and default impls returning fixture data.

- [ ] **Step 1: Write failing tests**

`consoleBuffer.test.ts`:
```ts
it("appendLine_respects_max_and_keeps_tail", ...)  // max 3, push 5 -> last 3 texts, ids 3,4,5
it("appendLine tags stream", ...)                  // stderr entry keeps stream
it("clearLines empties", ...)
```
`serviceStore.test.ts`:
```ts
it("applyOutput writes into per-service buffer", ...)
it("applyStatus upserts status map", ...)
it("applyError appends synthetic stderr line", ...)
it("buffers are independent per service", ...)
```
`useServices.test.tsx`:
```ts
it("renders status updates from bridge events", ...)   // emitStatus -> hook state updates (renderHook + act)
it("start calls bridge and reports actionError on reject", ...) // mock startService rejects -> actionError set
it("unsubscribes on unmount", ...)                      // emit after unmount does not throw / callback count stable
```
`useReadiness.test.tsx`:
```ts
it("polls probeTcp while enabled", ...)                 // fake timers, probeTcp returns true -> hook true
it("disabled when port null", ...)                      // no probe calls
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL, modules missing.

- [ ] **Step 3: Implement modules** per Interfaces. Note: `createServicesStore` is instantiated once per `useServices` mount via `useRef` with `maxLines` from `bridge.getConfig()` default `2000` fallback — keep it simple: accept `maxLines` as an argument of `createServicesStore` and have `useServices` use a module-level singleton store created lazily with `2000` (Settings applies `maxLogLines` only as a cap going forward — pass `maxLines` into `useServices(maxLines = 2000)`).

- [ ] **Step 4: Verify** — `npm test` green; `npm run typecheck` clean; `npm run lint` clean.

### Task 9: App shell + layout components + styles

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/global.css`, `src/components/layout/Icon.tsx`, `src/components/layout/TopBar.tsx`, `src/components/layout/TabBar.tsx`, `src/components/layout/LanguageSwitcher.tsx`, `src/components/layout/layout.test.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`, `index.html` (title → `MCSManager Desktop`), `package.json` unchanged
- Delete: `src/App.css`, `src/assets/react.svg` (template leftovers)

**Interfaces:**
- Consumes: Task 7 `useI18n`, Task 8 `useBridge`/`useServices` (App wiring only).
- Produces (used by Tasks 10–12):
  - `Icon({ name, size = 16 }: { name: "play" | "stop" | "restart" | "settings" | "globe" | "refresh" | "external" | "copy" | "trash" | "logo"; size?: number })` — inline SVG, `aria-hidden`.
  - `TabBar({ tabs, active, onChange }: { tabs: { id: TabId; label: string }[]; active: TabId; onChange: (id: TabId) => void })` with `export type TabId = "dashboard" | "panel";`
  - `LanguageSwitcher({ language, onChange }: { language: Language; onChange: (l: Language) => void })` — two pill buttons labeled via `t("language.en")` / `t("language.zh")` (no literals in code).
  - `TopBar({ activeTab, onTabChange, onStartAll, onStopAll, onOpenSettings, busy }: {...})` — logo + title + `TabBar` + `LanguageSwitcher` + start-all/stop-all buttons + settings icon button.
  - `App({ bridge? }: { bridge?: Bridge })` — wraps `BridgeProvider`, `I18nProvider`; holds `tab` state; renders `TopBar` + (`Dashboard` | `BrowserTab` — placeholder strings until Tasks 10/11: render `<div data-testid="dashboard-placeholder" />` / `<div data-testid="browser-placeholder" />`); opens `SettingsModal` (placeholder until Task 12). Dashboard/BrowserTab imports get added in their tasks.
  - `tokens.css`: CSS custom properties `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-dim`, `--accent`, `--success`, `--warning`, `--danger`, `--mono`; dark palette. `global.css` imports tokens and sets body font/scrollbars.
- UI tests here cover shell only; dashboard tests come in Task 10.

- [ ] **Step 1: Write failing tests** in `src/components/layout/layout.test.tsx`:

```ts
it("renders app title from i18n", ...)                // "MCSManager Desktop" title node uses t("app.title")
it("tab switching calls onChange", ...)               // click Panel tab -> onChange("panel")
it("language switcher flips visible copy", ...)       // click 中文 pill -> title becomes zh value
it("start all button is wired", ...)                  // click -> onStartAll called once
it("settings button opens settings", ...)             // onOpenSettings called
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL, components missing.

- [ ] **Step 3: Implement components, tokens, App shell** per Interfaces. `App` accepts injected `bridge` prop defaulting to real `bridge` (this is the test seam for Tasks 13).

- [ ] **Step 4: Verify** — `npm test` green; `npm run typecheck` clean; `npm run lint` clean; `npm run build` (tsc + vite) succeeds.

### Task 10: Dashboard (ServiceCard + ConsolePanel)

**Files:**
- Create: `src/components/dashboard/Dashboard.tsx`, `src/components/dashboard/ServiceCard.tsx`, `src/components/dashboard/ConsolePanel.tsx`, `src/components/dashboard/StatusBadge.tsx`, `src/components/dashboard/ActionButton.tsx`, `src/components/dashboard/dashboard.test.tsx`
- Modify: `src/App.tsx` (swap dashboard placeholder for `Dashboard`)

**Interfaces:**
- Consumes: Tasks 7–9 (`useServices`, `useReadiness`, `useI18n`, `Icon`).
- Produces:
  - `StatusBadge({ state }: { state: ServiceState })` — dot + `t("state." + state)`.
  - `ActionButton({ kind, busy, disabled, onClick }: { kind: "start" | "stop" | "restart"; busy?: boolean; disabled?: boolean; onClick: () => void })` — label from `t("action." + kind)`.
  - `ConsolePanel({ lines, onClear, onCopy }: { lines: ConsoleLine[]; onClear: () => void; onCopy: () => void })` — owns `autoScroll` state (checkbox `t("console.autoScroll")`), auto-scrolls to bottom on new lines when enabled (via ref + effect), copy/clear icon buttons; stderr lines styled with `data-stream="stderr"`.
  - `ServiceCard({ serviceId, status, lines, ready, onAction, busy }: { serviceId: ServiceId; status: ServiceStatus; lines: ConsoleLine[]; ready: boolean | null; onAction: (a: "start" | "stop" | "restart") => void; busy: boolean })` — name `t("service.<id>.name")`, `StatusBadge`, PID/uptime/exitCode rows (`t("status.pid")` etc.); uptime is computed from `status.startedAt` and re-rendered by a 1 s interval tick while `state === "running"` (cleared on unmount), formatted `H:MM:SS`; ready pill when `ready !== null`; three `ActionButton`s (start disabled when running/starting, stop disabled when stopped/stopping, restart disabled when not running), embedded `ConsolePanel`.
  - `Dashboard()` — uses `useServices()` + `useReadiness` for both services' `readyPort` (host `127.0.0.1`); renders two `ServiceCard`s (daemon, panel) in a responsive grid; a small banner if `actionError` is set.

- [ ] **Step 1: Write failing tests** in `src/components/dashboard/dashboard.test.tsx` (render with `mockBridge` + `I18nProvider` + `BridgeProvider`):

```ts
it("renders both service cards", ...)                // t("service.daemon.name") and t("service.panel.name") present
it("status badge maps states", ...)                  // emitStatus running -> badge text t("state.running")
it("console shows streamed lines and respects stderr style", ...) // emitOutput x2 -> both lines rendered, stderr has data-stream="stderr"
it("clear empties the console", ...)                 // click clear -> lines gone
it("stop button enabled only when running", ...)
it("renders pid and exit code", ...)                 // status with pid 42 -> "42" visible
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL.

- [ ] **Step 3: Implement dashboard components** per Interfaces; `Dashboard` wires service ids `"daemon"` and `"panel"` (fixed order: daemon first).

- [ ] **Step 4: Verify** — `npm test` green; `npm run typecheck` clean; `npm run lint` clean.

### Task 11: BrowserTab (panel web view)

**Files:**
- Create: `src/components/browser/BrowserTab.tsx`, `src/components/browser/browser.test.tsx`
- Modify: `src/App.tsx` (swap browser placeholder for `BrowserTab`)

**Interfaces:**
- Consumes: Tasks 7–9.
- Produces:
  - `BrowserTab({ url, ready, serviceState, onStartPanel }: { url: string; ready: boolean | null; serviceState: ServiceState; onStartPanel: () => void })` — toolbar (url text `t` not needed for URL itself, refresh button `t("browser.refresh")`, external button `t("browser.openExternal")` calling `window.open(url, "_blank")` via bridge-free `openExternal` prop: `{ onOpenExternal: () => void }` — add to props so tests can spy: final signature `BrowserTab({ url, ready, serviceState, onStartPanel, onOpenExternal }: {...})`); iframe `<iframe title={t("tab.panel")} src={url} key={refreshNonce} />` filling the content area; when `serviceState !== "running"` render overlay with `t("browser.notRunning.title")`, `t("browser.notRunning.hint")` and a start button wired to `onStartPanel`.
  - `App` wires it: `url = config.panelUrl` (from `useConfig`; default `"http://localhost:23333"` while loading), `onOpenExternal` uses `@tauri-apps/plugin-opener` `openUrl` inside `bridge`? Keep the shell thin: `App` passes `onOpenExternal = () => openUrl(url)` imported from `@tauri-apps/plugin-opener` in a tiny `src/services/openExternal.ts` wrapper (mockable in tests via prop injection — tests pass their own spy).

- [ ] **Step 1: Write failing tests** in `src/components/browser/browser.test.tsx`:

```ts
it("browser_tab_renders_configured_url", ...)        // url "http://localhost:23333" -> iframe src attribute equals it
it("browser_tab_shows_overlay_when_down", ...)       // serviceState "stopped" -> overlay text present, iframe absent
it("refresh reloads frame key", ...)                 // click refresh -> iframe key/attr changes (data-refresh nonce attr)
it("external button delegates to onOpenExternal", ...)
it("start button calls onStartPanel", ...)
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL.

- [ ] **Step 3: Implement `BrowserTab` + `openExternal.ts`** per Interfaces (iframe `src` uses the `url` prop verbatim — config is the single source of truth).

- [ ] **Step 4: Verify** — `npm test` green; `npm run typecheck` clean; `npm run lint` clean.

### Task 12: Settings modal + config editing

**Files:**
- Create: `src/components/settings/SettingsModal.tsx`, `src/components/settings/ServiceSettingsForm.tsx`, `src/components/settings/settings.test.tsx`
- Modify: `src/App.tsx` (wire real `SettingsModal`)

**Interfaces:**
- Consumes: Tasks 7–9 (`useConfig`, `Bridge`, `AppConfig`).
- Produces:
  - `ServiceSettingsForm({ serviceId, value, onChange }: { serviceId: ServiceId; value: ServiceConfig; onChange: (v: ServiceConfig) => void })` — fields: enabled (checkbox), workingDir, script, extraArgs (comma-separated text ⇄ `string[]`), startDelayMs (number), readyPort (number, empty ⇄ `null`).
  - `SettingsModal({ open, config, warnings, saving, error, onSave, onClose }: { open: boolean; config: AppConfig | null; warnings: string[]; saving: boolean; error: string | null; onSave: (c: AppConfig) => void; onClose: () => void })` — sections General (language select, nodePath, panelUrl, stopTimeoutMs, maxLogLines), Services (two `ServiceSettingsForm`s), About (`getAppInfo` via bridge prop-less: uses `useBridge()`), footer Save/Close; English-only warning strings render as-is; `t("settings.saved")` confirmation state after successful save.
  - `App` wires `useConfig()` and shows `SettingsModal` when `settingsOpen`.

- [ ] **Step 1: Write failing tests** in `src/components/settings/settings.test.tsx`:

```ts
it("edits panel url and saves validated config", ...)     // type into panelUrl input, click save -> onSave called with new value
it("ready port empty becomes null", ...)                  // clear readyPort -> onSave config.services.panel.readyPort === null
it("extra args comma parsing round-trips", ...)           // type "a,b" -> onSave extraArgs ["a","b"]
it("shows save error when bridge rejects", ...)           // error prop visible
it("shows path warnings", ...)                            // warnings ["missing dir"] rendered
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL.

- [ ] **Step 3: Implement `SettingsModal` + `ServiceSettingsForm`** per Interfaces. Numeric inputs parse with `Number(...)` and clamp only at `save` time via config `validate` rules surfaced as `error` (do not silently mutate).

- [ ] **Step 4: Verify** — `npm test` green; `npm run typecheck` clean; `npm run lint` clean.

### Task 13: Integration flows + final verification

**Files:**
- Create: `src/test/integration/appFlows.test.tsx`, `src/test/integration/noChinese.test.ts` (move from `src/test/noChinese.test.ts` if preferred — keep original path, do not duplicate)
- Modify: `README.md` (replace template text with: what the app is, how to point it at a built MCSManager (`workingDir` = `production-code/daemon` / `production-code/web`, `script` = `app.js`; dev checkout: `script` = `production/app.js`), how to run tests)
- Modify: anything the tests force to fix

**Interfaces:**
- Consumes: `App` with `createMockBridge()`.
- Produces: none (verification task).

- [ ] **Step 1: Write failing integration tests** in `src/test/integration/appFlows.test.tsx`:

```ts
it("start-all flow streams both services", ...)
    // click start-all -> calls contains startAll; emitStatus running for daemon+panel;
    // emitOutput for both -> both consoles show lines
it("stop flow and unexpected exit show error state", ...)
    // emitStatus error with exitCode 1 -> badge t("state.error") + exit code text visible
it("language toggle switches entire chrome", ...)
    // click 中文 -> top bar actions show zh values; service names from zh.json
it("tabs switch between dashboard and panel", ...)
    // click Panel tab -> iframe with config.panelUrl visible; click Dashboard -> cards visible
it("browser overlay start shortcut starts panel", ...)
    // panel stopped -> overlay; click overlay start -> calls startService("panel")
it("settings round-trip saves through bridge", ...)
    // open settings, change panelUrl, save -> calls contains saveConfig with value; close works
it("console ring cap honored end to end", ...)
    // emit 2100 lines -> rendered line count <= maxLogLines (2000)
```

- [ ] **Step 2: Run tests to verify they fail** — Expected: FAIL wherever behavior is missing.

- [ ] **Step 3: Implement/fix minimal code** to make the flows pass (should mostly pass already; fix gaps). Update `README.md` as specified.

- [ ] **Step 4: Final verification (all must pass; run in order)**

```powershell
npm run typecheck        # clean
npm run lint             # clean
npm test                 # all vitest suites green
npm run test:rust        # all cargo tests green
npm run build            # tsc && vite build succeeds
```

- [ ] **Step 5: Manual smoke (informational, not automated)** — document in the final report that `tauri dev` launch + config pointing at `C:\Workspace\MCSManager\panel` (script `production/app.js`) and `C:\Workspace\MCSManager\daemon` was used to eyeball start/stop/stream and the panel tab.
