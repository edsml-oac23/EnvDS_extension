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

  context.subscriptions.push(
    vscode.commands.registerCommand('eds-guide.checkDependencies', () => {
      vscode.commands.executeCommand('workbench.action.terminal.focus');
      vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
        text: 'uv --version && just --version && docker ps\n'
      });
    })
  );

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

    if (!fs.existsSync(htmlPath)) {
      return `<h3>Error: sidebarView.html not found in extension.</h3>`;
    }

    let html = fs.readFileSync(htmlPath, 'utf8');
    const tocContent = this.generateTocContentSync();

    // Insert generated TOC into the #course-content div
    html = html.replace(
      '<div id="course-content"></div>',
      `<div id="course-content">${tocContent}</div>`
    );

    return html;
  }

  private generateTocContentSync(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
      return `<div style="padding:15px">Please open the <b>EnvDataScience-guide</b> repository.</div>`;
    }

    const tocPath = path.join(workspaceFolders[0].uri.fsPath, '.guide', 'toc.json');

    if (!fs.existsSync(tocPath)) {
      return `<div style="padding:15px; color:#f88">Missing: <b>.guide/toc.json</b> not found in workspace.</div>`;
    }

    try {
      const tocData = fs.readFileSync(tocPath, 'utf8');
      const tocJson = JSON.parse(tocData);
      let content = '';

      if (Array.isArray(tocJson.categories)) {
        tocJson.categories.forEach((category: any) => {
          content += `
            <div class="session">
              <div class="session-header">${this.escapeHtml(category.title || 'Untitled')}</div>`;

          if (Array.isArray(category.steps)) {
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
                    ${this.escapeHtml(step.title || 'Untitled Step')}
                  </div>
                </div>`;
            });
          }

          content += `</div>`;
        });
      } else {
        content = `<div style="padding:15px">Invalid toc.json format: missing 'categories' array.</div>`;
      }

      return content;
    } catch (err) {
      return `<div style="padding:15px; color:#f88">Error loading toc.json: ${(err as Error).message}</div>`;
    }
  }

  private async handleOpenGuide(mdPath: string, notebookPath?: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const rootUri = workspaceFolders[0].uri;

    if (notebookPath && notebookPath.trim()) {
      const nbUri = vscode.Uri.joinPath(rootUri, notebookPath);
      try {
        await vscode.commands.executeCommand('vscode.open', nbUri);
        return;
      } catch {
        // Fall through to markdown
      }
    }

    if (mdPath && mdPath.trim()) {
      const mdUri = vscode.Uri.joinPath(rootUri, mdPath);
      await vscode.commands.executeCommand('markdown.showPreviewToSide', mdUri);
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