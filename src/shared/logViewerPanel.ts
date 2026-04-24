import * as vscode from 'vscode';
import { parsePinoDocument } from './pinoLog';

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

export async function openPinoLogViewer(
  extensionUri: vscode.Uri,
  resourceUri?: vscode.Uri,
): Promise<void> {
  const uri = resourceUri ?? (await pickLogFileUri());

  if (!uri) {
    return;
  }

  const rawData = await vscode.workspace.fs.readFile(uri);
  const text = new TextDecoder().decode(rawData);
  const parsed = parsePinoDocument(text);

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

  panel.webview.html = buildHtml(panel.webview, extensionUri, name, {
    fileName: name,
    entries: parsed.entries,
    invalidLines: parsed.invalidLines,
    invalidLineEntries: parsed.invalidLineEntries,
    invalidLineSample: formatLineList(parsed.invalidLines),
    totalLines: parsed.totalLines,
  });

  const msgDisposable = panel.webview.onDidReceiveMessage(
    async (message: { command: string }) => {
      if (message.command !== 'openFile') {
        return;
      }
      const newUri = await pickLogFileUri();
      if (!newUri) {
        return;
      }
      const newRaw = await vscode.workspace.fs.readFile(newUri);
      const newText = new TextDecoder().decode(newRaw);
      const newParsed = parsePinoDocument(newText);
      const newName = fileNameFromUri(newUri);
      panel.title = `Pino Log Viewer: ${newName}`;
      void panel.webview.postMessage({
        command: 'fileLoaded',
        state: {
          fileName: newName,
          entries: newParsed.entries,
          invalidLines: newParsed.invalidLines,
          invalidLineEntries: newParsed.invalidLineEntries,
          invalidLineSample: formatLineList(newParsed.invalidLines),
          totalLines: newParsed.totalLines,
        },
      });
    },
  );

  panel.onDidDispose(() => msgDisposable.dispose());
}
