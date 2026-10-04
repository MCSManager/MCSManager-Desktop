# MCSManager Desktop

A Windows desktop shell for running [MCSManager](https://github.com/MCSManager/MCSManager) locally.
It starts and stops your MCSManager daemon and panel as child processes, streams their live
console output, and embeds the panel web UI in a tabbed window. Built with Tauri v2 (Rust)
and React 19 + TypeScript.

## Requirements

- Node.js 22 or newer (to install, develop, and to run the managed services)
- Rust toolchain (for `cargo` / Tauri builds; see [Tauri prerequisites](https://tauri.app/start/prerequisites/))
- A **built** MCSManager deployment, either:
  - a release build with `production-code/daemon` and `production-code/web` directories, or
  - a dev checkout containing `daemon/` and `panel/` directories (each with `production/app.js`)

## Configuration

Open Settings in the app, or edit `config.json` directly. The file lives next to the app's
data directory:

```
%APPDATA%/com.yumao.mcsmanager-desktop/config.json
```

It is created with defaults on first launch; a corrupt file is backed up to `config.json.bak`
and replaced with defaults.

Each service (`daemon` and `panel`) is configured with:

- `workingDir` — the directory containing `app.js`, e.g. `C:/MCSManager/production-code/daemon`
  and `C:/MCSManager/production-code/web` for release builds. For a dev checkout point at the
  `daemon` and `panel` directories instead and set `script` to `production/app.js`.
- `script` — the entry file run inside `workingDir` (`app.js` for release builds,
  `production/app.js` for a dev checkout)
- `extraArgs`, `startDelayMs` (milliseconds to wait before starting the panel), `readyPort`
  (TCP port polled for readiness), `enabled`

Global fields: `nodePath` (Node.js executable), `panelUrl` (URL opened in the Panel tab),
`stopTimeoutMs`, `maxLogLines`, `language`.

## Run

```
npm install
npm run tauri dev     # develop with hot reload
npm run tauri build   # produce a bundled installer
```

## Tests

```
npm test              # frontend unit + integration tests (vitest)
npm run test:rust     # backend tests (cargo)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run format:check  # prettier
```
