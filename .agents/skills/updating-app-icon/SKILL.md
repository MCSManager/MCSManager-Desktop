---
name: updating-app-icon
description: Use when replacing or updating the MCSManager Desktop application icon (taskbar, exe, installer) from a new source image such as an SVG or PNG, or when a rebuilt exe still shows the previous icon.
---

# Updating the app icon

## Overview

The Windows app icon (taskbar, exe, installers) is generated from one square source
image into `src-tauri/icons/` by the Tauri CLI. `tauri.conf.json` already points at
the standard filenames, so **no config edit is needed**. The trap: the Rust build
does **not** treat the icon files as inputs, so a normal rebuild silently keeps the
old icon unless you force it.

## When to Use

- A new logo/SVG/PNG must become the app icon
- A rebuilt exe still shows the previous icon
- You need to know which files `tauri icon` touches, or where the icon comes from

## Quick Reference

| Goal                                  | Command (run from repo root)                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| Regenerate icons from source          | `npx tauri icon "path\to\source.svg"`                                              |
| Drop mobile-only output (Windows app) | `Remove-Item -Recurse -Force src-tauri\icons\android, src-tauri\icons\ios`         |
| Force the exe to re-embed the icon    | `cargo clean --release --manifest-path src-tauri/Cargo.toml -p mcsmanager-desktop` |
| Rebuild exe + installers              | `npm run tauri build`                                                              |
| List changed icons                    | `git status --short src-tauri/icons`                                               |

## Steps

1. Use a **square** source. An SVG with a square `viewBox` (e.g. `0 0 1024 1024`) or
   a 1024x1024 PNG works; the generator scales it to every required size. Prefer an
   image that already contains its own background — icon sizes are not padded.
2. Regenerate the icon set from the repo root, pointing at wherever the source image
   currently lives (it is not necessarily at the repo root):
   ```powershell
   npx tauri icon "path\to\source.svg"
   ```
   (`npm run tauri -- icon "<source>"` is equivalent.) Output overwrites everything in
   `src-tauri/icons/`.
3. Delete the mobile-only output the generator also emits — this project is
   Windows-only:
   ```powershell
   Remove-Item -Recurse -Force src-tauri\icons\android, src-tauri\icons\ios
   ```
4. Force the Rust build to re-embed the icon. `tauri-build` declares
   `rerun-if-changed` only for `tauri.conf.json`, `permissions`, and `capabilities`
   (see the generated build output), **not** for the icon files — so skip this and
   `npm run tauri build` may keep the previous icon. The **`--release` flag is
   required**: without it `cargo clean -p` targets the dev profile and removes 0
   files:
   ```powershell
   cargo clean --release --manifest-path src-tauri/Cargo.toml -p mcsmanager-desktop
   ```
5. Rebuild:
   ```powershell
   npm run tauri build
   ```
   Output layout is unchanged: `src-tauri/target/release/mcsmanager-desktop.exe`,
   plus the NSIS and MSI installers under `src-tauri/target/release/bundle/`.
6. Verify before shipping:
   ```powershell
   Add-Type -AssemblyName System.Drawing
   $i = [System.Drawing.Icon]::ExtractAssociatedIcon("src-tauri\target\release\mcsmanager-desktop.exe")
   $i.ToBitmap().Save("$env:TEMP\exe-icon.png")
   ```
   Open `$env:TEMP\exe-icon.png`, then run the exe and confirm the taskbar/window icon
   and the installer wizard show the new image.

## What `tauri icon` regenerates

Everything under `src-tauri/icons/`: `32x32.png`, `64x64.png`, `128x128.png`,
`128x128@2x.png` (256px), `icon.png` (512px), `icon.ico`, `icon.icns`, the Windows
Store `Square*Logo.png` / `StoreLogo.png`, and the `android/` + `ios/` folders.
`tauri.conf.json`'s `bundle.icon` already lists the files Tauri needs, so edit it only
if filenames change. The window/taskbar icon is derived automatically at build time;
there is no explicit `.icon()` call to update in `src-tauri/src/lib.rs`.

## Common Mistakes

| Mistake                                                             | Why it hurts                                                        | Fix                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Editing `bundle.icon` or PNGs by hand                               | Wrong sizes/format; installers reject or render blurry              | Run `npx tauri icon` and commit the generated set                          |
| Rebuilding without cleaning                                         | Build script doesn't track icons, so exe/taskbar keep the old image | `cargo clean --release -p mcsmanager-desktop` before `npm run tauri build` |
| Committing `android/` and `ios/` output                             | Dead weight in a Windows-only repo                                  | Delete both folders after generating                                       |
| Non-square source                                                   | The image is squashed into square icons                             | Use a square `viewBox` / a 1024x1024 source                                |
| Forgetting the installers                                           | Wizard/Add-Remove icon comes from the same `icon.ico`               | Rebuild the bundles too (`npm run tauri build`)                            |
| Expecting `index.html`'s `/vite.svg` favicon to change the app icon | The OS icon is the window/bundle icon, not a webview favicon        | The favicon is unrelated; replace it separately only if you want to        |
| Icon still looks old in Explorer                                    | Windows icon cache, not a build failure                             | Refresh with `ie4uinit.exe -show`, or restart Explorer                     |
