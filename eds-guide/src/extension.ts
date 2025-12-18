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

  // IMPROVED "Check Dependencies" command
  context.subscriptions.push(
  vscode.commands.registerCommand('eds-guide.checkDependencies', () => {
    const terminal = vscode.window.createTerminal({
      name: 'EDS Environment Check',
      cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath
    });
    terminal.show();
    terminal.sendText(`
uv --version | awk '{print "uv: " $2}'
just --version
mamba list --quiet geospatial | tail -1 | awk '{print "geospatial: " $2}'
mamba list --quiet segment-geospatial | tail -1 | awk '{print "segment-geospatial: " $2}'
mamba list --quiet geoai-py | tail -1 | awk '{print "geoai-py: " $2}'
    `);
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

    const modules = Array.isArray(tocJson) ? tocJson : [];

    if (modules.length === 0) {
      return `<div style="padding:15px">Invalid toc.json format.</div>`;
    }

    modules.forEach((module: any) => {
      const weekTitle = module.label || 'Untitled Week';
      const introPath = module.markdown || '';
      const lessons = module.lessons || [];

      // Week header — bold, larger, clickable to open intro.md
      content += `
        <div class="session">
          <div class="section-title" style="font-weight: bold; font-size: 1.2em; padding: 14px 15px; background-color: var(--vscode-sideBarSectionHeader-background); cursor: pointer;"
            data-path="${introPath}"
            data-desc="${this.escapeHtml(module.description || '')}"
            data-checkdeps="false">
            ${this.escapeHtml(weekTitle)}
          </div>`;

      // Indented lessons
      lessons.forEach((lesson: any) => {
        const lessonTitle = lesson.label || 'Untitled Lesson';
        const lessonMd = lesson.markdown || '';
        const notebookPath = lesson.notebook || '';
        const hasCheckDeps = lesson.actions?.some((a: any) => a.command === 'eds-guide.checkDependencies') || false;

        content += `
          <div class="section" style="margin-left: 20px;">
            <div class="section-title"
              data-path="${lessonMd}"
              data-desc="${this.escapeHtml(lesson.description || '')}"
              data-checkdeps="${hasCheckDeps ? 'true' : 'false'}"
              ${notebookPath ? `data-notebook="${notebookPath}"` : ''}>
              ${this.escapeHtml(lessonTitle)}
            </div>
          </div>`;
      });

      content += `</div>`;
    });

    return content;
  } catch (err) {
    return `<div style="padding:15px; color:#f88">Error loading toc.json: ${(err as Error).message}</div>`;
  }
}

  private async handleOpenGuide(mdPath: string, notebookPath?: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;
  const rootUri = workspaceFolders[0].uri;

  // Close previous editors to keep the view clean
  await vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');

  // Prefer notebook if present
  if (notebookPath && notebookPath.trim()) {
    const nbUri = vscode.Uri.joinPath(rootUri, notebookPath);
    await vscode.commands.executeCommand('vscode.open', nbUri, {
      viewColumn: vscode.ViewColumn.Active,
      preview: false
    });
    return;
  }

  // Open markdown in rendered preview 
  if (mdPath && mdPath.trim()) {
    const mdUri = vscode.Uri.joinPath(rootUri, mdPath);
    await vscode.commands.executeCommand('markdown.showPreview', mdUri);
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