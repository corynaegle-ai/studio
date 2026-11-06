# SteleFab source-to-desktop development

Run these commands from the steel workspace root (`/Users/cory.naegle/projects/steel`). Use an isolated worktree at a reviewed commit from `https://github.com/corynaegle-ai/stelefab-app.git`. This route builds that source independently, integrates its static browser edition into a separate copy of the existing Studio app, and leaves the working baseline unchanged. It does not require the private getcadcraft.com site checkout or recompile Rust for JavaScript/settings changes.

## Prerequisites

- Node20.19+ (observed26.12.1).
- PHP8.1+ (installed with `HOMEBREW_NO_AUTO_UPDATE=1 /opt/homebrew/bin/brew install php`; observed PHP8.5.12, Homebrew8.5.12_1). No PHP service is started.
- Source checkout `cadcraft-detailcraft` and baseline suite `cadcraft-studio/out/studio-suite/v0.8.1`.
- Existing macOS bundle `cadcraft-desktop-shell/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/CadCraft Studio.app`.
- A reviewed branded native executable built from the intended committed desktop-shell source. Set `STELEFAB_NATIVE_EXECUTABLE` to its absolute path. For an app-only rebuild, an existing accepted executable may be reused with its source/build provenance recorded; a native-source change requires a new native build. The stager deliberately refuses SteleFab without this input.
- macOS `codesign` and `PlistBuddy`.

## Build and stage

Use fresh output directories; builders refuse to overwrite existing candidates.

Set `APP_SOURCE` and `STUDIO_SOURCE` to the reviewed app and Studio worktree directories. Set `STELEFAB_BASELINE_APP` to the preserved baseline bundle and `STELEFAB_ICON` to the reviewed desktop-shell ICNS file. Record their commit/build identities with the candidate. These are explicit inputs, so the recipe never falls back to the dirty originals.

```sh
: "${APP_SOURCE:?Set the reviewed app worktree}" "${STUDIO_SOURCE:?Set the reviewed Studio worktree}"
: "${STELEFAB_NATIVE_EXECUTABLE:?Set the reviewed branded executable}" "${STELEFAB_BASELINE_APP:?Set the preserved baseline bundle}" "${STELEFAB_ICON:?Set the reviewed ICNS path}"
node "$STUDIO_SOURCE/tools/seed-detailcraft-vendor.mjs" "$APP_SOURCE" cadcraft-studio/out/studio-suite/v0.8.1
PHP_BIN=/opt/homebrew/bin/php node "$STUDIO_SOURCE/tools/build-detailcraft-edition.mjs" --source "$APP_SOURCE" --suite cadcraft-studio/out/studio-suite/v0.8.1 --out work/runtime-integration/pilot-units-3
node "$STUDIO_SOURCE/tools/check-detailcraft-edition.mjs" --edition work/runtime-integration/pilot-units-3/edition/detailcraft-browser-edition-vdev --report work/runtime-integration/pilot-units-3/dependency-audit.json
node "$STUDIO_SOURCE/tools/stage-detailcraft-macos.mjs" --edition work/runtime-integration/pilot-units-3/edition/detailcraft-browser-edition-vdev --baseline "$STELEFAB_BASELINE_APP" --hub-source "$STUDIO_SOURCE/hub/hub.js" --icon "$STELEFAB_ICON" --executable "$STELEFAB_NATIVE_EXECUTABLE" --out work/runtime-integration/pilot-units-3/SteleFab.app
```

The vendor seeder copies existing suite bytes only when size and SHA256 match the source checkout's `devshell/vendor.json`. Unneeded cpython-wasi files are absent from the suite; that does not affect the DetailCraft edition. The builder runs the official `devshell/edition.mjs` with `--offline`, so unexpected missing libraries stop the build. If a future source needs missing vendors, run its official `devshell/fetch-vendor.mjs` for that library, which verifies expected hashes.

The builder snapshots `app/`, `devshell/` and notices before packing. It records source HEAD/status, working-tree patch, snapshot input hashes and packaging recovery provenance. Historical recovery snapshots also captured untracked modules. New feature handoffs must commit all owned source and tests before review/merge; a snapshot alone is not a Git checkpoint.

## Bounded upstream packaging corrections

The public0.8.1 source/packer is incomplete. Corrections occur only in the isolated snapshot:

1. Recover omitted `app-lang-boot.js` and the pinned bootstrap-icons shared-shell dependency from the existing licensed0.8.1 suite.
2. Include source `app-devices-ui.js` and `app-devices.js` in the packer's copy list.
3. Include unmodified official `app-devices-studio.js` and `app-addons-account.js`, absent from both the public source and baseline suite. Pinned source URLs, SHA256 values and license are in `detailcraft-build-support/provenance.json`; builder verifies bytes before use.

No customer drawings are sent to those sources. The checked-in support copies make subsequent builds offline and repeatable. All corrections appear in `build-inputs.json`; hashes include the corrected snapshot packer. If upstream's copy list changes, review the assertion rather than silently skipping it.

The dependency audit checks literal HTML paths, JS relative imports and import-map targets. It explicitly records the existing optional render-engine add-on imports, which belong to ModelCraft/BimCraft and are not exercised by DetailCraft. It is not a browser/runtime test.

## Studio integration and acceptance

The stager copies the baseline `.app`, replaces only the copied DetailCraft edition, retains its self-contained assets without deduplication, enables Studio handoff flags, adjusts suite offline metadata, and injects the baseline Studio bridge/language payload. It signs the copy ad hoc and runs `codesign --verify --deep --strict`. The original executable and DetailCraft index hashes must remain unchanged.

This is an integrated development candidate, not a fresh official full-suite release. Other seven apps remain baseline0.8.1. The binary version and compiled application identifier remain unchanged. **Close all baseline Studio windows before opening the candidate by its full path**; otherwise the single-instance plugin redirects into the already-running baseline. Renaming `Info.plist` alone does not change its compiled single-instance key.

The root agent/user performs UI acceptance: open the exact source pilot, inspect geometry, change drawing dimensions in Settings, export actual PDF/BOM, reopen and render PDF, verify dimension labels/profile units, and compare immutable source dimensions. Rendering internally generated display lists or passing static checks alone does not establish desktop acceptance.

Rollback is reopening the untouched baseline `.app` by its original full path after closing the candidate. No installer, file association or live baseline resource changes are required. Keep candidate/build records until acceptance is documented.

## Observed candidate

`work/runtime-integration/pilot-units-3` packs583 edition files (75.4MB), contains exact final formatter source hashes, and resolves all audited direct HTML/import-map and non-optional literal module paths. Runtime acceptance is recorded separately by the root agent. Earlier candidates remain evidence and are not silently rewritten while running.
