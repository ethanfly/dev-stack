# AGENTS.md

Windows-only Electron + Vue 3 + TypeScript desktop app (**DevStack**) that installs and switches local PHP / MySQL / Nginx / Redis / Node.js / Go / Python / Rust / Git, plus sites, hosts, and logs. Product UI and most comments are Chinese. User-visible name lives in `src/brand.ts` (`APP_NAME`).

Do not treat this as a web app. There is no public HTTP UI to verify in a browser.

## Commands

```bash
npm install
npm run electron:dev    # Vite + Electron (same as npm run dev)
npm run typecheck       # vue-tsc --noEmit
npm run build:nobump    # pack without bumping package.json
```

- `npm run build` / `build:patch|minor|major` **rewrite `package.json` version** and `public/version.json`. Do not run them unless the user asked to release.
- Output installer/portable builds land in `release/` (gitignored).
- There is no test runner, ESLint, or Prettier config. Typecheck is the automated gate.
- Dev services and downloads live under `./service/` (gitignored). Packaged installs use a sibling `service/` next to the app directory.

## Architecture

| Layer | Path | Role |
| --- | --- | --- |
| Main | `electron/main.ts` | Window, tray, single-instance lock, `ipcMain.handle` |
| Managers | `electron/services/*Manager.ts` | Downloads, install/uninstall, PATH, process control |
| Config | `electron/services/ConfigStore.ts` | `electron-store` schema + `basePath` helpers |
| Preload | `electron/preload.ts` | `contextBridge` API **and** `Window['electronAPI']` types |
| Renderer | `src/` | Vue 3 + Pinia + Element Plus, hash router |

Security model: `contextIsolation: true`, `nodeIntegration: false`. The renderer talks **only** through `window.electronAPI`.

Packaged app uses `file://`, so routing **must** stay `createWebHashHistory()`. Window is frameless; close hides to tray (`isQuitting` is the only real exit). NSIS requests administrator (`requestedExecutionLevel: requireAdministrator`).

`src/vite-env.d.ts` must **not** redeclare `Window.electronAPI`. Types come from `export type ElectronAPI = typeof api` in `electron/preload.ts`.

## IPC contract (required for every new API)

Keep these three files in lockstep. A method that exists in only one layer is a bug.

1. Implement on the manager in `electron/services/`.
2. Register `ipcMain.handle("ns:method", ...)` in `electron/main.ts`. Channel names are `php:…`, `mysql:…`, `nginx:…`, `redis:…`, `node:…`, `go:…`, `rust:…`, `python:…`, `git:…`, `java:…`, `dotnet:…`, `postgres:…`, `mongodb:…`, `service:…`, `hosts:…`, `config:…`, `log:…`, `app:…`, `window:…`, `shell:…`, `dialog:…`, `composer:…`.
3. Add the same method on the `api` object in `electron/preload.ts` via `ipcRenderer.invoke`.

Renderer calls `window.electronAPI?.php.install(version)` (optional-chain: preload may be missing in a plain Vite tab).

Mutating operations return `{ success: boolean; message: string }` (sometimes extra `details`). Views show `ElMessage.success/error` from `message`.

Push-only events:

- `sendDownloadProgress(type, progress, downloaded, total)` from `electron/main.ts` → `download-progress`
- `service-status-changed` after tray start/stop all

Known drift (do not copy): preload exposes `app.setAutoStartServices` / `getAutoStartServices` with **no** main handlers; main exposes `mysql:reinitialize` with **no** preload method.

## Adding a runtime / page

1. `electron/services/XxxManager.ts` — same class shape as `NodeManager` / `GoManager`.
2. Wire constructor + IPC in `electron/main.ts`.
3. Expose under `api` in `electron/preload.ts`.
4. `src/views/XxxManager.vue` with `defineOptions({ name: 'XxxManager' })` (KeepAlive in `App.vue` matches this name).
5. Hash route in `src/router/index.ts`, nav item + `cachedViews` in `src/App.vue`.
6. Extend `ConfigStore` schema if you persist versions / active path.

## Data layout (`ConfigStore.getBasePath()`)

```
{basePath}/
  php/php-{version}/
  mysql/mysql-{version}/
  nginx/          sites-available/  sites-enabled/  ssl/
  redis/
  nodejs/
  go/
  rust/
  python/python-{version}/
  java/jdk-{version}/
  dotnet/dotnet-{version}/
  postgres/
  mongodb/
  logs/  temp/  www/
  path_backup.txt
```

- Dev: `<repo>/service`
- Packaged: sibling of the install dir (e.g. `C:\DevTools\service` if the app is `C:\DevTools\DevStack\`)

`active*Version` is the display / isActive key. `active*Path` is set when the active tool is a **system** install so helpers do not resolve into the managed tree.

Installed tool entries use `source`: `managed` | `system` (Python also `mise`; Rust `rustup`). System installs only support set-as-default + uninstall. CGI / extensions / ini / logs are managed-only.

## PATH — do not regress this

All user-PATH writes go through `PathManager` (`electron/services/PathManager.ts`) and `withPathLock` (`pathLock.ts`).

- Remove **only** entries under an explicit managed prefix (e.g. `{basePath}\php`). Never glob `*\php-*` or similar.
- Writes backup PATH to `{basePath}/path_backup.txt`.
- Cliff guard: if original PATH is longer than 500 chars and the new value would shrink below 40%, abort.
- PowerShell `.ps1` files **must** be UTF-8 **with BOM**. Windows PowerShell 5.1 otherwise decodes Chinese comments as GBK and throws parse errors.
- After a successful write, `PathManager` refreshes `process.env.PATH` in this process (Windows does not deliver `WM_SETTINGCHANGE` to Electron).

Do not call `[Environment]::SetEnvironmentVariable('PATH', …)` from a manager. Do not invent a second PATH writer.

## Manager conventions

- Scan the managed directory, then merge `detectSystem*` (use the real binary dir, not a version-manager shim). Dedup against managed paths.
- `getAvailableVersions()` fetches the official/mirror list and falls back to a hardcoded list on network failure. Filter out already-installed versions where existing managers do that.
- Downloads use Node `https`/`http`, follow redirects, and call `sendDownloadProgress` with a stable `type` (`php`, `mysql`, `nginx`, `redis`, `nodejs`, `go`, `python`, `git`, `java`, `dotnet`, `postgres`, `mongodb`, `php-ext`).
- Child processes: `{ windowsHide: true }` and a timeout. Start long-lived servers via `ServiceManager.startProcess` (VBS `WshShell.Run …, 0, False`, spawn fallback). No flashing consoles.
- `exec` / `taskkill` / `netstat` are acceptable; this app is Windows-only.
- Uninstalling a `source === 'system'` tree is irreversible. Guard with “exe exists in this directory” and a strong `ElMessageBox.confirm` in the view.

PHP-CGI port: `9000 + major * 10 + minor` (`8.4.x` → `9084`). Do not hardcode `9000` for multi-version CGI (the leftover `9000` in the Startup `.bat` writer is a known inconsistency).

Sites live in `ConfigStore.sites` **and** Nginx conf under `sites-available` / `sites-enabled`. Hosts edits go through `HostsManager` (`sudo-prompt` on `C:\Windows\System32\drivers\etc\hosts`).

App auto-launch (packaged only): scheduled task `PHPerDevManager` plus `silent_start.vbs` next to the exe, UTF-16 LE with BOM. Service auto-start: `%APPDATA%\…\Startup\phper-{service}.bat`.

## Frontend conventions

- Vue 3 `<script setup lang="ts">`. Register KeepAlive names with `defineOptions`.
- Element Plus + `@element-plus/icons-vue`. User feedback: `ElMessage` / `ElMessageBox`.
- Page chrome: `.page-container` / `.page-header` / `.card` already used across views.
- Colors and radii live in `src/styles/main.scss` (teal accent `#0d9488`, default theme is dark). Prefer those CSS variables over new hex values.
- Alias `@/` → `src/`.
- Quote style is mixed (double in newer Electron files, single in many Vue SFCs). Match the file you edit. Two-space indent.
- New user-facing strings stay Chinese.

`useServiceStore` covers dashboard status (nginx / mysql / redis / php-cgi, PHP + Node lists, sites). Other tools keep local view state.

## Do not

- Mutate the user PATH except via `PathManager`.
- Add or change an IPC method in only one of main / preload / renderer.
- Switch the router to HTML5 history.
- Quit the app on window `close` (tray).
- Start services with a visible console.
- Delete an arbitrary directory in `uninstallSystem` — require the tool’s exe first.
- Check in `service/`, `release/`, `dist/`, or `dist-electron/`.
- Duplicate product docs from `README.md` into code comments.

## Verification

- After TypeScript or IPC changes: `npm run typecheck`.
- After UI or service-control changes: `npm run electron:dev` and exercise the page (install dialog, set-as-default, start/stop, theme). There are no browser DevTools against a website.
- PATH changes: confirm only the intended prefix moved, and `{basePath}/path_backup.txt` updated.
- Do not claim a pack/install path works unless you actually ran `build:nobump` or installed the NSIS package.
