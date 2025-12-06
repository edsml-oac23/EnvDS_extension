import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
const MarkdownIt = require('markdown-it');

// -----------------------------------------------------------------------------
// 1. EXTENSION ACTIVATION
// -----------------------------------------------------------------------------
export function activate(context: vscode.ExtensionContext) {
  
  // Register the Sidebar (A)
  const courseOutlineProvider = new CourseOutlineProvider(context.extensionPath);
  vscode.window.registerTreeDataProvider(
    'eds-guide.courseOutlineView', // Must match package.json view ID
    courseOutlineProvider
  );

  // Command: Open The Guide (B)
  context.subscriptions.push(
    vscode.commands.registerCommand('eds-guide.openSection', (section) => {
      SectionWebviewPanel.createOrShow(context.extensionUri, context.extensionPath, section);
    })
  );

  // Command: Check Dependencies (Triggered by Button in B)
  context.subscriptions.push(
    vscode.commands.registerCommand('eds-guide.checkDependencies', () => {
      const terminalName = 'EDSML Setup';
      let terminal = vscode.window.terminals.find(t => t.name === terminalName);
      if (!terminal) terminal = vscode.window.createTerminal(terminalName);
      
      terminal.show();
      terminal.sendText("echo 'EDSML: Synchronising environment...'");
      terminal.sendText("uv sync");
      terminal.sendText("uv run python -c \"import leafmap; print('✅ OpenGeos Stack Ready!')\"");
    })
  );
}

// -----------------------------------------------------------------------------
// 2. SIDEBAR PROVIDER (Block A)
// -----------------------------------------------------------------------------
class CourseOutlineProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private extensionPath: string) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    // 1. Find the Student's Repo (The Workspace)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return Promise.resolve([]);
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // 2. Top Level
    if (!element) {
      return Promise.resolve([
        new SectionItem("Module Practicals", "Course content", vscode.TreeItemCollapsibleState.Expanded, "practicals"),
      ]);
    }

    // 3. Read toc.json
    if (element.id === "practicals") {
      const tocPath = path.join(workspaceRoot, '.guide', 'toc.json');
      if (!fs.existsSync(tocPath)) return Promise.resolve([]);

      const toc = JSON.parse(fs.readFileSync(tocPath, 'utf8'));
      let items: SectionItem[] = [];

      toc.categories.forEach((category: any) => {
        // Create Category (e.g. "Week 1")
        items.push(new SectionItem(category.title, "", vscode.TreeItemCollapsibleState.Expanded));

        // Create Steps (e.g. "1.1 Setup")
        category.steps.forEach((step: any) => {
          const stepItem = new SectionItem(step.title, step.description, vscode.TreeItemCollapsibleState.None);
          
          // 🔴 IMPORTANT: Pass the Category Title (e.g. "Week 1") to the view
          stepItem.command = {
            command: 'eds-guide.openSection',
            title: 'Open Section',
            arguments: [{ ...step, categoryTitle: category.title }], 
          };
          items.push(stepItem);
        });
      });
      return Promise.resolve(items);
    }
    return Promise.resolve([]);
  }
}

class SectionItem extends vscode.TreeItem {
  constructor(label: string, desc: string, state: vscode.TreeItemCollapsibleState, id?: string) {
    super(label, state);
    this.description = desc;
    this.id = id;
  }
}

// -----------------------------------------------------------------------------
// 3. WEBVIEW PANEL (Block B - The "Red Area" / Design)
// -----------------------------------------------------------------------------
class SectionWebviewPanel {
  public static currentPanel: SectionWebviewPanel | undefined;
  public static readonly viewType = 'edsGuideSection';
  private readonly _panel: vscode.WebviewPanel;

  public static createOrShow(extensionUri: vscode.Uri, extensionPath: string, section: any) {
    if (SectionWebviewPanel.currentPanel) {
      SectionWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      SectionWebviewPanel.currentPanel._update(section);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SectionWebviewPanel.viewType,
      section.title,
      vscode.ViewColumn.One,
      { enableScripts: true, localResourceRoots: [extensionUri] }
    );
    SectionWebviewPanel.currentPanel = new SectionWebviewPanel(panel, extensionUri, extensionPath, section);
  }

  private constructor(panel: vscode.WebviewPanel, uri: vscode.Uri, path: string, section: any) {
    this._panel = panel;
    this._update(section);
    this._panel.onDidDispose(() => { SectionWebviewPanel.currentPanel = undefined; this._panel.dispose(); });
    
    // Handle Button Clicks
    this._panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'openNotebook') {
         const root = vscode.workspace.workspaceFolders?.[0].uri;
         if(root) vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(root, msg.notebook));
      } else if (msg.command === 'checkDependencies') {
         vscode.commands.executeCommand('eds-guide.checkDependencies');
      }
    });
  }

  private _update(section: any) {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, section);
  }

  // 🔴 DESIGN LOGIC: REPLICATING ML.SCHOOL
  private _getHtmlForWebview(webview: vscode.Webview, section: any) {
    const md = new MarkdownIt();
    const nonce = "randomNonce123"; // Simplification for brevity
    
    // 1. DATA PREP
    const eyebrow = section.categoryTitle ? section.categoryTitle.toUpperCase() : "MODULE CONTENT";
    const title = section.title;
    
    // 2. READ MARKDOWN CONTENT
    let content = "<p>No content found.</p>";
    if (section.file && vscode.workspace.workspaceFolders) {
        const filePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, section.file);
        if(fs.existsSync(filePath)) content = md.render(fs.readFileSync(filePath, 'utf8'));
    }

    // 3. BUILD BUTTONS
    let buttonsHtml = "";
    
    // Button: Check Dependencies (Only on Setup pages)
    if (title.includes("Preparing") || title.includes("Setup") || title.includes("1.1")) {
        buttonsHtml += `
            <button class="btn secondary" onclick="sendMessage('checkDependencies')">
                <span class="icon">⚡</span> Check Dependencies
            </button>`;
    }

    // Button: Open Notebook (If notebook exists)
    if (section.notebook) {
        buttonsHtml += `
            <button class="btn primary" onclick="sendMessage('openNotebook', '${section.notebook}')">
                <span class="icon">📘</span> Open Practical Notebook
            </button>`;
    }

    // 4. GENERATE HTML (The ml.school Design)
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
            /* BASE RESET */
            body {
                font-family: var(--vscode-font-family);
                font-size: 15px;
                line-height: 1.6;
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                margin: 0;
                padding: 40px; /* Padding around the whole page */
                max-width: 900px;
            }

            /* HIERARCHY */
            .eyebrow {
                font-size: 0.85em;
                font-weight: 700;
                letter-spacing: 1.5px;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                margin-bottom: 10px;
            }

            h1 {
                font-size: 2.5em;
                font-weight: 800;
                margin: 0 0 30px 0;
                line-height: 1.1;
                color: var(--vscode-editor-foreground);
            }

            /* BUTTONS - STACKED LEFT */
            .button-group {
                display: flex;
                flex-direction: column; /* Stack them vertically */
                align-items: flex-start; /* Align to the LEFT */
                gap: 12px;
                margin-bottom: 40px;
                padding-bottom: 30px;
                border-bottom: 1px solid var(--vscode-widget-border);
            }

            .btn {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 20px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                width: auto;
                min-width: 250px; /* Make them look substantial */
                text-align: left;
            }

            .primary {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            .primary:hover { opacity: 0.9; }

            .secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            .secondary:hover { opacity: 0.9; }

            /* MARKDOWN CONTENT */
            .content {
                text-align: left; /* Ensure text is left aligned */
            }
            code { background: var(--vscode-textBlockQuote-background); padding: 2px 4px; border-radius: 4px; }
            img { max-width: 100%; border-radius: 4px; }
            a { color: var(--vscode-textLink-foreground); text-decoration: none; }
        </style>
    </head>
    <body>
        
        <div class="eyebrow">${eyebrow}</div>
        <h1>${title}</h1>

        <div class="button-group">
            ${buttonsHtml}
        </div>

        <div class="content">
            ${content}
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            function sendMessage(command, notebookPath) {
                vscode.postMessage({ command: command, notebook: notebookPath });
            }
        </script>
    </body>
    </html>`;
  }
}