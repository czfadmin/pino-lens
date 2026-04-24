# Pino Log Viewer

Pino Log Viewer is a dual-target VS Code extension (desktop + web) for opening, visualizing, and filtering pino JSON logs.

## Features

- Open log files from command palette or explorer context menu.
- Parse line-delimited pino JSON logs (NDJSON style).
- Interactive filtering by:
	- full-text search (message + JSON payload)
	- level (trace/debug/info/warn/error/fatal)
	- time range
	- max rendered rows
- Visual table with level badges, timestamp, message, and original line number.
- Detail panel to inspect full JSON payload for the selected row.
- Parse diagnostics for invalid JSON rows.

## Usage

1. Run command: Pino Log Viewer: Open Log File
2. Select a .log/.json/.jsonl/.ndjson file
3. Filter and inspect logs in the viewer panel

You can also right-click a file in explorer and choose the same command.

## Example Pino Log Format

```json
{"level":30,"time":1713916800000,"msg":"api started","service":"gateway"}
{"level":50,"time":1713916900000,"msg":"request failed","err":{"code":"E_PIPE"}}
```

## Development

- Install: pnpm install
- Build all: pnpm run compile
- Build desktop: pnpm run compile:desktop
- Build web: pnpm run compile:web
- Test desktop: pnpm run test:desktop
- Test web: pnpm run test:web
- Lint: pnpm run lint

## Architecture

- Desktop host entry: src/desktop/extension.ts
- Web host entry: src/web/extension.ts
- Shared parser and viewer logic:
	- src/shared/pinoLog.ts
	- src/shared/logViewerPanel.ts

## Current Limitations

- Input format is expected to be one JSON object per line.
- Very large files are loaded fully into memory before rendering.
- The extension currently focuses on file-based log inspection (not live stream ingestion).

## Roadmap

- Saved filter presets
- Column customization
- Field-specific quick filters
- Follow mode for appended log files
