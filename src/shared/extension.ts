import * as vscode from 'vscode';
import { openPinoLogViewer } from './logViewerPanel';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    'pino-log-viewer.openLogFile',
    async (resourceUri?: vscode.Uri) => {
      try {
        await openPinoLogViewer(context, resourceUri);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to open pino log: ${message}`);
      }
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
