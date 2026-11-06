# Existing-window native focus MCP extension

`studio_windows_focus({window})` accepts the exact stable ID or `studioLabel` from `studio_windows_list`. App-name shortcuts are refused. The maintained relay validates both native methods exist before advertising this tool, then checks the **fresh** native registry for the exact label/app before calling `desk.windows.focus(label)`. That native method validates existence and performs unminimize/show/focus. A second registry read reports whether the window is actually focused. Missing/closed windows fail; there is no open, reload, close, document command or model change fallback.

A successful result contains `nativeFocusCompleted`, `nativeWindowFocused`, `appResponseVerified:false` and `modelChanged:false`. Focus completion does **not** establish frontend listener liveness. Follow with a separately deadline-bounded app read (for example `detail_app_info` with an 8-second transport deadline). This is a presentation action exposed in the existing hub read group, separate from document edit permission. Existing `studio_apps_open` behavior is unchanged.

## Maintained source and integration

- `cadcraft-detailcraft/app/host.js`: dependency-free canonical relay extension, delimited by `maintained-native-window-focus` comments.
- `cadcraft-studio/hub/hub.js`: supplies the genuine `desk.windows` native adapter.
- `cadcraft-studio/tools/native-window-focus-overlay.mjs`: pure minimal overlay generator. It refuses any baseline host/hub source difference outside this reviewed delta, allowing only the preexisting presentation branding normalization. It records before/after SHA256 and canonical source SHA256.
- `stage-detailcraft-macos.mjs`: applies that narrow overlay **only to a fresh output bundle**, only when the packed edition contains the extension. Legacy editions keep their original shared relay and launch behavior. An incompatible shared-shell version fails closed, rather than replacing it wholesale. Multiple packed host versions are refused. `--hub-source <frozen hub.js>` pins a reviewed source snapshot; freeze this alongside the browser edition and retain the recorded hashes. Default is the maintained source path.

Source changes cannot safely install this operation into the already loaded running process: its ES modules and relay registrations are already in memory. Editing its signed bundle would not update those registrations and would invalidate the signature. No hot injection, reload, relaunch, current-bundle modification or model operation is part of this change. Root integration must stage a new signed candidate and choose a safe transition; current MCP recovery remains unproven.

## Verification

```sh
node cadcraft-detailcraft/tests/bin/test-detailcraft-native-window-focus.mjs
node cadcraft-studio/tools/test-native-window-focus-overlay.mjs [existing-baseline.app]
```

The first executes the actual relay and dispatcher against native/transport boundary substitutes, including duplicate document IDs, native registry freshness, missing/wrong-app/race/focus-failure cases, unavailable adapter discovery, absence of app commands/fallback opens, and preservation of explicit app-open behavior. The second checks exact compatible transformation, idempotence, branding variants and unrelated source refusal. Its optional baseline argument reads actual bundle sources, verifies compatibility in memory and checks unchanged source hashes; it never writes or stages a bundle. Actual AppKit focus and post-focus frontend responsiveness still require separate runtime acceptance after deployment.
