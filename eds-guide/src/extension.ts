import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
  const provider = new EdsGuideSidebarProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('eds-guide.courseOutlineView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Command: Check dependencies
  context.subscriptions.push(
    vscode.commands.registerCommand('eds-guide.checkDependencies', () => {
      vscode.commands.executeCommand('workbench.action.terminal.focus');
      vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
        text: 'uv --version && just --version && docker ps\n'
      });
    })
  );

  // Optional: Refresh command (useful during development)
  context.subscriptions.push(
    vscode.commands.registerCommand('eds-guide.refreshGuide', () => {
      provider.refresh();
    })
  );
}

class EdsGuideSidebarProvider implements vscode.WebviewViewProvider {
  public _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public refresh() {
    if (this._view) {
      this._view.webview.html = ''; // Force reload
      this._view.webview.html = this.getHtmlContentSync();
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtmlContentSync();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'openGuide':
          await this.handleOpenGuide(message.path, message.notebook);
          break;
        case 'checkDependencies':
          vscode.commands.executeCommand('eds-guide.checkDependencies');
          break;
      }
    });
  }

  private getHtmlContentSync(): string {
    const htmlPath = path.join(this.context.extensionPath, 'src', 'webview', 'sidebarView.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const tocContent = this.generateTocContentSync();
    const assignmentsContent = this.generateAssignmentsContentSync();

    html = html.replace('<!-- TOC_PLACEHOLDER -->', tocContent);
    html = html.replace('<!-- ASSIGNMENTS_PLACEHOLDER -->', assignmentsContent);

    // Notify the webview that dynamic content has been injected
    const notifyScript = `
      <script>
        if (typeof acquireVsCodeApi !== 'undefined') {
          acquireVsCodeApi().postMessage({ command: 'tocLoaded' });
        }
      </script>
    `;
    html = html.replace('</body>', `${notifyScript}</body>`);

    return html;
  }

  private generateTocContentSync(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return '<div>No workspace open. Please open the EnvDataScience-guide folder.</div>';
    }

    try {
      const tocPath = path.join(workspaceFolders[0].uri.fsPath, '.guide', 'toc.json');
      const tocData = fs.readFileSync(tocPath, 'utf8');
      const tocJson = JSON.parse(tocData);

      let content = '';
      tocJson.categories.forEach((category: any) => {
        content += `
          <div class="session">
            <div class="session-header">${this.escapeHtml(category.title)}</div>
        `;

        category.steps.forEach((step: any) => {
          const checkDeps = step.checkdeps === true ? 'true' : 'false';
          const notebookAttr = step.notebook ? `data-notebook="${step.notebook}"` : '';
          content += `
            <div class="section">
              <div class="section-title"
                data-path="${step.file || ''}"
                data-desc="${this.escapeHtml(step.description || '')}"
                data-checkdeps="${checkDeps}"
                ${notebookAttr}>
                ${this.escapeHtml(step.title)}
              </div>
            </div>
          `;
        });

        content += '</div>';
      });

      return content;
    } catch (err) {
      return `<div>Error loading TOC: ${this.escapeHtml((err as Error).message)}</div>`;
    }
  }

  private generateAssignmentsContentSync(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return '';

    try {
      const assignmentsPath = path.join(workspaceFolders[0].uri.fsPath, '.guide', 'assignments.json');
      const assignmentsData = fs.readFileSync(assignmentsPath, 'utf8');
      const assignmentsJson = JSON.parse(assignmentsData);

      let content = `
        <div class="session">
          <div class="session-header">${this.escapeHtml(assignmentsJson.title || 'Assignments')}</div>
      `;

      (assignmentsJson.assignments || []).forEach((assignment: any) => {
        const notebookAttr = assignment.notebook ? `data-notebook="${assignment.notebook}"` : '';
        content += `
          <div class="section">
            <div class="section-title"
              data-path=""
              data-desc="${this.escapeHtml(assignment.description || '')}"
              data-checkdeps="false"
              ${notebookAttr}>
              ${this.escapeHtml(assignment.title)}
            </div>
          </div>
        `;
      });

      content += '</div>';
      return content;
    } catch (err) {
      return ''; // Silently ignore missing assignments.json
    }
  }

  private async handleOpenGuide(mdPath: string, notebookPath?: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    let uri: vscode.Uri;
    if (notebookPath && notebookPath.trim()) {
      uri = vscode.Uri.joinPath(workspaceFolders[0].uri, notebookPath);
    } else if (mdPath && mdPath.trim()) {
      uri = vscode.Uri.joinPath(workspaceFolders[0].uri, mdPath);
    } else {
      return;
    }

    try {
      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to open file: ${(err as Error).message}`);
    }
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}