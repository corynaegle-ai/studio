# DetailCraft MCP connection

For the maintained existing-window focus extension and its deployment limits, see [native-window-focus.md](native-window-focus.md). That extension requires a newly integrated signed build; it does not repair an already loaded process by changing files.

`detailcraft-mcp.mjs` adapts newline-delimited stdio MCP to Studio's existing authenticated loopback HTTP server. It needs Node 20+ and no npm packages. It reads Studio's private `connect.json` at runtime; credentials are not copied into Codex settings. The advertised upstream `@getcadcraft/mcp` package returned npm E404 during setup.

## Installed configuration

Codex server name: `cadcraft`, enabled in `~/.codex/config.toml`.

```toml
[mcp_servers.cadcraft]
command = "/opt/homebrew/bin/node"
args = ["/Users/cory.naegle/projects/steel/cadcraft-studio/tools/detailcraft-mcp.mjs"]
startup_timeout_sec = 40
tool_timeout_sec = 150

[mcp_servers.cadcraft.env]
CADCRAFT_STUDIO_APP = "/Users/cory.naegle/projects/steel/work/runtime-integration/pilot-units-2/DetailCraft Pilot Studio.app"
```

The app path selects the current pilot. Update it when adopting another candidate. Studio uses a single application identifier across builds: close the old build before switching candidates.

The bridge launches the configured app with `--app=detailcraft` if it cannot initially connect. `detail_launch` also launches/focuses DetailCraft explicitly. Initialization is retried for up to 25 seconds; model operations are never automatically replayed. A token or address change triggers a new session before the next request. Studio's permissions remain authoritative.

DetailCraft Settings > Assistants is enabled for read, edit, save, export. The only allowed folder is `/Users/cory.naegle/projects/steel`. The other CadCraft apps are not enabled. Restart the Codex client or start a session that reloads MCP configuration to discover the newly added server.

## Steel detailing

Start with `studio_windows_list`, then use `detail_app_info`, `detail_model_describe`, `detail_parts_list`, `detail_problems_list`, and `detail_clash_check`. Pass a specific `window` when multiple documents are open. Geometry is in millimetres.

`detail_member_add` supports beams, columns, braces and plates. `detail_connection_add` adds supported parametric connections; `detail_undo` reverses assistant changes. Save/export permissions are enabled, but native save dialogs can still require a destination. Export formats include IFC, DSTV NC, BOM, KISS, cut lists, bending schedules and USD. Drawing/PDF exports are not exposed by the current upstream MCP tools.

The running pilot's edit preview restores geometry but marks the document unsaved and may leave a redo entry. Avoid previews on clean user documents until that application behavior is corrected. Setup's preview was cleared by reopening the original plate JSON; no model file was overwritten.

## Verification

`work/mcp/acceptance.json` in the steel workspace records live stdio initialization, 43 advertised tools (including `detail_launch`), the existing plate and BOM, permitted workspace folder, and successful launch without changing the model. The source file was reloaded after preview testing and a final read confirmed it was clean.

Remove the Codex entry with `codex mcp remove cadcraft`. Turn off DetailCraft Settings > Assistants to stop its MCP access.
