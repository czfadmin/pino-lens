import * as vscode from 'vscode';
import { parsePinoDocument, parsePinoLines } from './pinoLog';

const VIEW_TYPE = 'pino-log-viewer.panel';

function fileNameFromUri(uri: vscode.Uri): string {
  const segments = uri.path.split('/').filter((part) => part.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : uri.path;
}

function formatLineList(lines: number[], max = 25): string {
  if (lines.length === 0) {
    return 'none';
  }

  const sampled = lines.slice(0, max).join(', ');
  if (lines.length <= max) {
    return sampled;
  }

  return `${sampled} ... (+${lines.length - max} more)`;
}

function asJsonString(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  title: string,
  payload: unknown,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'pinoLogViewer.js'),
  );
  const initialData = asJsonString(payload);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource};" />
  <title>${title}</title>
</head>
<body>
  <script type="application/json" id="pinoInitialData">${initialData}</script>
  <pino-log-viewer></pino-log-viewer>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

async function pickLogFileUri(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Open Pino Log File',
    filters: {
      'Log files': ['log', 'txt', 'json', 'jsonl', 'ndjson'],
      'All files': ['*'],
    },
  });

  return picked?.[0];
}

const PRESETS_KEY = 'pino-log-viewer.presets';

interface FilterState {
  search: string;
  level: string;
  from: string;
  to: string;
  limit: number;
}

interface SavedPreset {
  name: string;
  filter: FilterState;
}

export async function openPinoLogViewer(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri,
): Promise<void> {
  const extensionUri = context.extensionUri;
  const uri = resourceUri ?? (await pickLogFileUri());

  if (!uri) {
    return;
  }

  // Read custom level mapping from VS Code settings
  const configMapping = vscode.workspace
    .getConfiguration('pino-log-viewer')
    .get<Record<string, string>>('customLevelMapping', {});
  const customLevelMap: Record<number, string> = {};
  for (const [k, v] of Object.entries(configMapping)) {
    const n = Number(k);
    if (Number.isInteger(n) && typeof v === 'string' && v.length > 0) {
      customLevelMap[n] = v;
    }
  }

  const rawData = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder().decode(rawData);
  const parsed = parsePinoDocument(text, customLevelMap);

  const name = fileNameFromUri(uri);
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    `Pino Log Viewer: ${name}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    },
  );

  // Stream entries in batches so the UI becomes interactive quickly
  const STREAM_INITIAL = 1000;
  panel.webview.html = buildHtml(panel.webview, extensionUri, name, {
    fileName: name,
    entries: parsed.entries.slice(0, STREAM_INITIAL),
    invalidLines: parsed.invalidLines,
    invalidLineEntries: parsed.invalidLineEntries,
    invalidLineSample: formatLineList(parsed.invalidLines),
    totalLines: parsed.totalLines,
    totalEntries: parsed.entries.length,
    presets: context.globalState.get<SavedPreset[]>(PRESETS_KEY, []),
    customLevelMap,
  });

  // --- Streaming: send remaining entries in batches after initial render ---
  let disposed = false;
  if (parsed.entries.length > STREAM_INITIAL) {
    void (async () => {
      const CHUNK = 1000;
      for (let i = STREAM_INITIAL; i < parsed.entries.length; i += CHUNK) {
        // Yield to the event loop between chunks
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        if (disposed) {
          break;
        }
        const chunk = parsed.entries.slice(i, i + CHUNK);
        const progress = Math.min(99, Math.round((i + chunk.length) / parsed.entries.length * 100));
        const done = i + CHUNK >= parsed.entries.length;
        void panel.webview.postMessage({
          command: 'streamChunk',
          entries: chunk,
          progress,
          done,
        });
      }
    })();
  }

  // --- Follow mode state ---
  let followEnabled = false;
  let knownByteOffset = 0;
  let followWatcher: vscode.Disposable | undefined;

  async function loadAppendedBytes(fileUri: vscode.Uri): Promise<void> {
    try {
      const fullData = await vscode.workspace.fs.readFile(fileUri);
      if (fullData.byteLength <= knownByteOffset) {
        return;
      }
      const newBytes = fullData.slice(knownByteOffset);
      knownByteOffset = fullData.byteLength;
      const newText = new TextDecoder().decode(newBytes);
      const newParsed = parsePinoLines(newText, parsed.totalLines + 1, customLevelMap);
      if (newParsed.entries.length === 0 && newParsed.invalidLineEntries.length === 0) {
        return;
      }
      // Update our running totals so offsets stay correct across multiple appends
      parsed.entries.push(...newParsed.entries);
      parsed.invalidLines.push(...newParsed.invalidLines);
      parsed.invalidLineEntries.push(...newParsed.invalidLineEntries);
      parsed.totalLines += newParsed.totalLines;
      void panel.webview.postMessage({
        command: 'appendEntries',
        entries: newParsed.entries,
        invalidLines: newParsed.invalidLines,
        invalidLineEntries: newParsed.invalidLineEntries,
        totalLines: parsed.totalLines,
      });
    } catch {
      // File may have been renamed/deleted; stop following silently
      followEnabled = false;
      followWatcher?.dispose();
      followWatcher = undefined;
    }
  }

  function startFollow(fileUri: vscode.Uri): void {
    followWatcher?.dispose();
    const globPattern = new vscode.RelativePattern(
      vscode.Uri.file(fileUri.fsPath.replace(/[^/\\]*$/, '')),
      fileUri.fsPath.split(/[/\\]/).pop() ?? '*',
    );
    followWatcher = vscode.workspace.createFileSystemWatcher(globPattern, true, false, false);
    (followWatcher as vscode.FileSystemWatcher).onDidChange(() => loadAppendedBytes(fileUri));
    (followWatcher as vscode.FileSystemWatcher).onDidDelete(() => {
      followEnabled = false;
      followWatcher?.dispose();
      followWatcher = undefined;
    });
  }

  function stopFollow(): void {
    followWatcher?.dispose();
    followWatcher = undefined;
  }

  // Initialise byte offset after first load
  void vscode.workspace.fs.readFile(uri).then((buf) => {
    knownByteOffset = buf.byteLength;
  });

  const msgDisposable = panel.webview.onDidReceiveMessage(
    async (message: { command: string }) => {
      if (message.command === 'toggleFollow') {
        followEnabled = !followEnabled;
        if (followEnabled) {
          startFollow(uri);
        } else {
          stopFollow();
        }
        void panel.webview.postMessage({ command: 'followState', enabled: followEnabled });
        return;
      }

      if (message.command === 'savePreset') {
        const { name, filter } = message as { command: string; name: string; filter: FilterState };
        const presets = context.globalState.get<SavedPreset[]>(PRESETS_KEY, []);
        const idx = presets.findIndex((p) => p.name === name);
        if (idx >= 0) {
          presets[idx] = { name, filter };
        } else {
          presets.push({ name, filter });
        }
        await context.globalState.update(PRESETS_KEY, presets);
        void panel.webview.postMessage({ command: 'presetsLoaded', presets });
        return;
      }

      if (message.command === 'deletePreset') {
        const { name } = message as { command: string; name: string };
        const updated = context.globalState
          .get<SavedPreset[]>(PRESETS_KEY, [])
          .filter((p) => p.name !== name);
        await context.globalState.update(PRESETS_KEY, updated);
        void panel.webview.postMessage({ command: 'presetsLoaded', presets: updated });
        return;
      }

      if (message.command === 'exportFiltered') {
        const { format, lines } = message as { command: string; format: 'ndjson' | 'json'; lines: string[] };
        const baseName = fileNameFromUri(uri).replace(/\.[^.]+$/, '');
        const ext = format === 'ndjson' ? 'ndjson' : 'json';
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(uri.with({ path: uri.path.replace(/[^/\\]*$/, '') }), `${baseName}_filtered.${ext}`),
          filters: format === 'ndjson'
            ? { 'NDJSON / JSON Lines': ['ndjson', 'jsonl', 'log'] }
            : { 'JSON': ['json'] },
          saveLabel: 'Export',
        });
        if (!saveUri) {
          return;
        }
        let content: string;
        if (format === 'ndjson') {
          content = lines.join('\n');
        } else {
          const objects = lines.map((l) => {
            try { return JSON.parse(l) as unknown; } catch { return l; }
          });
          content = JSON.stringify(objects, null, 2);
        }
        await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(content));
        void vscode.window.showInformationMessage(
          `Exported ${lines.length} entr${lines.length === 1 ? 'y' : 'ies'} to ${fileNameFromUri(saveUri)}`,
        );
        return;
      }

      if (message.command !== 'openFile') {
        return;
      }
      const newUri = await pickLogFileUri();
      if (!newUri) {
        return;
      }
      // Stop following the old file when opening a new one
      followEnabled = false;
      stopFollow();

      const newRaw = await vscode.workspace.fs.readFile(newUri);
      const newText = new TextDecoder().decode(newRaw);
      const newParsed = parsePinoDocument(newText, customLevelMap);
      const newName = fileNameFromUri(newUri);
      panel.title = `Pino Log Viewer: ${newName}`;
      knownByteOffset = newRaw.byteLength;
      void panel.webview.postMessage({
        command: 'fileLoaded',
        state: {
          fileName: newName,
          entries: newParsed.entries.slice(0, STREAM_INITIAL),
          invalidLines: newParsed.invalidLines,
          invalidLineEntries: newParsed.invalidLineEntries,
          invalidLineSample: formatLineList(newParsed.invalidLines),
          totalLines: newParsed.totalLines,
          totalEntries: newParsed.entries.length,
          customLevelMap,
        },
      });
      // Stream remaining entries for the newly opened file
      if (newParsed.entries.length > STREAM_INITIAL) {
        void (async () => {
          const CHUNK = 1000;
          for (let i = STREAM_INITIAL; i < newParsed.entries.length; i += CHUNK) {
            await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
            if (disposed) {
              break;
            }
            const chunk = newParsed.entries.slice(i, i + CHUNK);
            const progress = Math.min(99, Math.round((i + chunk.length) / newParsed.entries.length * 100));
            const done = i + CHUNK >= newParsed.entries.length;
            void panel.webview.postMessage({ command: 'streamChunk', entries: chunk, progress, done });
          }
        })();
      }
    },
  );

  panel.onDidDispose(() => {
    disposed = true;
    msgDisposable.dispose();
    stopFollow();
  });
}
