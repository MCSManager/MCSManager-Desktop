---
name: building-windows-exe
description: Use when building, packaging, or releasing the MCSManager Desktop Windows exe or installer, when asked where build outputs land, what a build machine or target machine needs installed, or how the daemon/ and web/ service folders must be laid out next to the built exe.
---

# Building the Windows exe

## Overview

One command builds the app: `npm run tauri build`. Distribution is a **portable
layout** — the release exe resolves the fixed sibling folders `daemon/` and `web/`
as its run directory (see `src-tauri/src/config/paths.rs`; dev builds instead use
the workspace root).

## When to Use

- Producing a distributable exe or Windows installer
- Answering where build outputs land or what a machine needs installed
- Assembling a release folder, or diagnosing a built exe that "can't find" its services

## Quick Reference

| Goal                 | Command                                                           | Output                                                                        |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Check prerequisites  | `node -v` `rustc -V` `cargo -V`                                   | Node 22+, MSVC toolchain                                                      |
| Install deps         | `npm ci`                                                          | `node_modules/`                                                               |
| Quality gates        | `npm test` `npm run test:rust` `npm run typecheck` `npm run lint` | —                                                                             |
| Bare exe only        | `npm run tauri build -- --no-bundle`                              | `src-tauri/target/release/mcsmanager-desktop.exe`                             |
| Everything (default) | `npm run tauri build`                                             | exe + `src-tauri/target/release/bundle/nsis/*-setup.exe` + `bundle/msi/*.msi` |
| One installer only   | `npm run tauri build -- --bundles nsis` (or `msi`)                | chosen bundle under `src-tauri/target/release/bundle/`                        |

`npm run tauri build` runs `npm run build` (tsc + vite) itself, then
`cargo build --release`, then the bundlers — no manual frontend build needed.
The first bundling run downloads NSIS/WiX (network required). The first release
build is slow (`lto`, `codegen-units = 1`, `opt-level = 3`); minutes are normal.

## Release layout (fixed — not configurable)

```
<release folder>/
├── mcsmanager-desktop.exe
├── daemon/     # built MCSManager daemon deployment (must contain app.js)
└── web/        # built MCSManager panel deployment (app.js + public/)
```

- Folder names are fixed (`daemon`, `web`) and must be **siblings of the exe**.
- Keep the release folder writable: services create `data/` and `logs/` at runtime.
- When assembling a distribution, **exclude `data/` and `logs/`** from the service
  folders — they are runtime-generated, and `daemon/data/Config/global.json` holds
  the daemon access key (never ship it).
- The service bundles are self-contained — never run `npm install` inside them.
- Target machines need **Node 22+** on PATH (or set `nodePath` in Settings) and the
  **WebView2 Runtime** (preinstalled on Windows 10/11; installers can bootstrap it,
  the bare exe cannot).
- The panel auto-discovers the daemon via `../daemon/data/Config/global.json` —
  never separate the two folders.

## Prerequisites (build machine)

Node.js 22+ · Rust **MSVC** toolchain (`rustup default stable-msvc`) · Visual Studio
Build Tools with the "Desktop development with C++" workload · network access on the
first bundling run.

## Common Mistakes

| Mistake                                                     | Why it hurts                                                                                                          | Fix                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Distributing a debug build                                  | debug builds compile the build machine's workspace root in as the run dir — services are never found on user machines | ship only `target/release` output                                                         |
| Acceptance-testing the exe in place under `target/release/` | it looks for `target/release/daemon` and `target/release/web`                                                         | copy exe + folders into a clean release folder first                                      |
| Running the exe from inside the zip or extractor preview    | it extracts to a temp folder without the service folders, then warns `service folder is not an existing directory`    | extract the full zip to a local writable folder, then run                                 |
| Shipping the MSI into `Program Files`                       | services must write `data/`/`logs/` next to the exe; Program Files is read-only for users                             | prefer the portable zip (exe + folders) or the NSIS per-user installer (`%LOCALAPPDATA%`) |
| Bumping the version in one place                            | installer names embed the version                                                                                     | sync `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`                  |
| SmartScreen "Windows protected your PC"                     | binaries are unsigned                                                                                                 | sign with a code-signing cert, or ship "More info → Run anyway" instructions              |
| `npm install` inside `daemon/` or `web/`                    | bundles are self-contained                                                                                            | not needed                                                                                |
