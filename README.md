# Pino Log Viewer

A VS Code extension (desktop + web) for opening, visualizing, and filtering [pino](https://getpino.io/) JSON logs — right inside your editor.

Stop squinting at raw NDJSON files. Pino Log Viewer gives you an interactive table with level badges, timestamps, full-text search, and a detail panel for any row, all without leaving VS Code.

---

## Features

- **One-click open** — open any pino log file from the Command Palette, the Explorer context menu, or the editor title bar.
- **NDJSON parsing** — parses line-delimited JSON (one object per line) and maps standard pino level numbers to human-readable labels (`trace` / `debug` / `info` / `warn` / `error` / `fatal`).
- **Interactive filtering**
  - Full-text search across message and JSON payload
  - Level filter (select one or more levels)
  - Time-range filter
  - Cap rendered rows to keep the view snappy on large files
- **Visual table** — color-coded level badges, formatted timestamp, message column, and original line number for easy cross-reference.
- **Detail panel** — click any row to inspect the complete JSON payload.
- **Parse diagnostics** — invalid JSON lines are flagged separately so you never lose sight of malformed entries.
- **Works everywhere** — runs in both the VS Code Desktop host and the VS Code for the Web (vscode.dev / github.dev) browser host.

---

## Supported File Types

| Extension | Description |
|-----------|-------------|
| `.log`    | Generic log files |
| `.json`   | JSON files |
| `.jsonl`  | JSON Lines |
| `.ndjson` | Newline-delimited JSON |
| `.txt`    | Plain-text log files |

---

## Getting Started

### Open a log file

**Method 1 — Command Palette**

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
2. Type **Pino Log Viewer: Open Log File** and press Enter.
3. Select your `.log` / `.json` / `.jsonl` / `.ndjson` file.

**Method 2 — Explorer context menu**

Right-click any supported file in the Explorer sidebar and choose **Open with Pino Log Viewer**.

**Method 3 — Editor context menu / title bar**

With a supported file open in the editor, right-click the editor area or the tab title and choose **Open with Pino Log Viewer**.

**Method 4 — Keyboard shortcut**

With a supported file focused, press `Ctrl+Shift+P, Ctrl+Shift+L` (Windows/Linux) or `Cmd+Shift+P, Cmd+Shift+L` (macOS).

### Filtering logs

Once the viewer is open, use the filter bar at the top to:

- Type a keyword to search across all fields.
- Toggle log levels to hide/show entries by severity.
- Set a time range to scope the view to a specific window.
- Limit the row count to keep rendering fast on very large files.

---

## Expected Log Format

Pino Log Viewer expects **one JSON object per line** (NDJSON). Standard pino output already uses this format:

```jsonl
{"level":30,"time":1713916800000,"pid":1234,"hostname":"server-1","msg":"api started","service":"gateway"}
{"level":40,"time":1713916860000,"pid":1234,"hostname":"server-1","msg":"slow query","duration":1523}
{"level":50,"time":1713916900000,"pid":1234,"hostname":"server-1","msg":"request failed","err":{"code":"E_PIPE"}}
```

Pino level numbers are mapped as follows:

| Number | Label  |
|--------|--------|
| 10     | trace  |
| 20     | debug  |
| 30     | info   |
| 40     | warn   |
| 50     | error  |
| 60     | fatal  |

Any line that is not valid JSON is listed in the **Parse Diagnostics** section at the bottom of the viewer.

---

## Current Limitations

- Each file is loaded fully into memory before rendering — very large files (hundreds of MB) may be slow.
- Only file-based inspection is supported; live log streaming is not yet implemented.
- Non-standard pino `time` field formats are accepted on a best-effort basis.

---

## Roadmap

### Completed

- [x] Saved filter presets
- [x] Column customization (show/hide fields)
- [x] Field-specific quick filters (click a value to filter by it)
- [x] Follow mode for appended log files (live tail)
- [x] Export filtered results

### Planned

#### Performance
- [x] Virtual / windowed scrolling — render only visible rows so very large files stay responsive
- [x] Incremental (streaming) file load — parse and display lines as they are read rather than waiting for the full file

#### Search & Filtering
- [x] Regex search — allow regular expression patterns in the search bar
- [x] Compound filter expressions — combine field conditions with AND / OR / NOT operators
- [x] Custom log-level mapping — let users configure non-standard level numbers to label names

#### Visualisation & Analysis
- [x] Log statistics panel — bar / timeline chart showing level distribution and event frequency over time

#### UX & Navigation
- [ ] Full keyboard navigation — move between rows, open detail panel, and toggle filters without a mouse
- [ ] Syntax highlighting in detail panel — colorise keys, strings, numbers, and booleans in the JSON inspector
#### Integration
- [ ] Attach to running process — stream pino output directly from a terminal or VS Code task instead of a static file

---

## Development

```bash
pnpm install          # install dependencies
pnpm run compile      # build both desktop and web targets
pnpm run compile:desktop  # build desktop only
pnpm run compile:web      # build web only
pnpm run test:desktop # run desktop tests
pnpm run test:web     # run web tests
pnpm run lint         # lint TypeScript sources
```

For iterative development, use the watch tasks:

```bash
# Desktop (run both in separate terminals)
pnpm run watch-desktop:tsc
pnpm run watch-desktop:esbuild

# Web
pnpm run watch-web:tsc
pnpm run watch-web:esbuild
```

### Architecture

| Path | Role |
|------|------|
| `src/desktop/extension.ts` | Desktop extension entry point |
| `src/web/extension.ts` | Web extension entry point |
| `src/shared/pinoLog.ts` | NDJSON parser and data model |
| `src/shared/logViewerPanel.ts` | Webview panel logic (shared) |
| `src/webview/pinoLogViewer.ts` | Webview UI script |

---

## License

See [LICENSE](LICENSE) for details.
