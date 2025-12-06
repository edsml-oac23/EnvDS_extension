import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
const MarkdownIt = require('markdown-it');

// This function is called when your extension is first activated
export function activate(context: vscode.ExtensionContext) {
  
  // Create a new TreeDataProvider and register it
  // We pass extensionPath to load local resources if needed
  const courseOutlineProvider = new CourseOutlineProvider(context.extensionPath);
  
  vscode.window.registerTreeDataProvider(
    'eds-guide.courseOutlineView',
    courseOutlineProvider
  );

  // Register the command that opens the main editor tab
  context.subscriptions.push(
    vscode.commands.registerCommand('eds-guide.openSection', (section) => {
      SectionWebviewPanel.createOrShow(context.extensionUri, context.extensionPath, section);
    })
  );

  // Register the "Check Dependencies" command (The logic for the Blue Button)
  context.subscriptions.push(
    vscode.commands.registerCommand('eds-guide.checkDependencies', () => {
      const terminalName = 'EDSML Setup';
      let terminal = vscode.window.terminals.find(t => t.name === terminalName);

      if (!terminal) {
        terminal = vscode.window.createTerminal(terminalName);
      }

      terminal.show();
      terminal.sendText("echo 'EDSML: Synchronising geospatial environment with uv...'");
      terminal.sendText("uv sync");
      terminal.sendText(
        "uv run python -c \"import geopandas, xarray, rioxarray, leafmap; print('✅ OpenGeos Stack Ready!')\""
      );
    })
  );
}
  

//##############################################################################
// 1. THE NAVIGATION LIST (TreeDataProvider)
// Reads toc.json from the Student Workspace
//##############################################################################
class CourseOutlineProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private extensionPath: string) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    
    // 1. Get the path to the Student's Open Folder (Workspace)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return Promise.resolve([]); // No folder open
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;


    // 2. Top Level Categories
    if (!element) {
      return Promise.resolve([
        new SectionItem("Module Practicals", "A list of all course practicals", vscode.TreeItemCollapsibleState.Expanded, "practicals"),
        new SectionItem("Assignments", "A list of all assignments", vscode.TreeItemCollapsibleState.Expanded, "assignments"),
      ]);
    }

    // 3. Practicals Section
    if (element.id === "practicals") {
      const tocPath = path.join(workspaceRoot, '.guide', 'toc.json');
      
      if (!fs.existsSync(tocPath)) {
          vscode.window.showErrorMessage("EDSML: Could not find .guide/toc.json in this workspace.");
          return Promise.resolve([]);
      }

      const toc = JSON.parse(fs.readFileSync(tocPath, 'utf8'));
      
      let practicalSections: SectionItem[] = [];
      toc.categories.forEach((category: any) => {
        const categoryItem = new SectionItem(
          category.title,
          category.description,
          vscode.TreeItemCollapsibleState.Expanded,
          category.title
        );
        practicalSections.push(categoryItem);

        category.steps.forEach((step: any) => {
          const stepItem = new SectionItem(
            step.title,
            step.description,
            vscode.TreeItemCollapsibleState.None, 
            step.title
          );
          
          // 🔴 CRITICAL UPDATE: Passing 'categoryTitle' to the command
          // This allows us to display "WEEK 1" in the webview header
          stepItem.command = {
            command: 'eds-guide.openSection',
            title: 'Open Guide Section',
            arguments: [{ ...step, categoryTitle: category.title }], 
          };
          practicalSections.push(stepItem);
        });
      });
      return Promise.resolve(practicalSections);
    }

    // 4. Assignments Section
    if (element.id === "assignments") {
      const assignPath = path.join(workspaceRoot, '.guide', 'assignments.json');
      
      if (fs.existsSync(assignPath)) {
        const assignments = JSON.parse(fs.readFileSync(assignPath, 'utf8'));
        const assignmentSections = assignments.assignments.map((assign: any) => {
            const assignItem = new SectionItem(
              assign.title,
              assign.description,
              vscode.TreeItemCollapsibleState.None
            );
            assignItem.command = {
              command: 'eds-guide.openSection',
              title: 'Open Guide Section',
              arguments: [assign], 
            };
            return assignItem;
        });
        return Promise.resolve(assignmentSections);
      }
    }

    return Promise.resolve([]);
  }
}

class SectionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    description: string, 
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly id?: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label} - ${description}`;
    this.description = description; 
  }
}

//##############################################################################
// 2. THE MAIN EDITOR TAB (WebviewPanel)
//##############################################################################
class SectionWebviewPanel {
  public static currentPanel: SectionWebviewPanel | undefined;
  public static readonly viewType = 'edsGuideSection';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _extensionPath: string;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, extensionPath: string, section: any) {
    if (SectionWebviewPanel.currentPanel) {
      SectionWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      SectionWebviewPanel.currentPanel._update(section);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SectionWebviewPanel.viewType,
      `Guide: ${section.title}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri], 
      }
    );

    SectionWebviewPanel.currentPanel = new SectionWebviewPanel(panel, extensionUri, extensionPath, section);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, extensionPath: string, section: any) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._extensionPath = extensionPath;

    this._update(section);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'openNotebook') {
          this._openNotebook(message.notebook);

        } else if (message.command === 'checkDependencies') {
          await vscode.commands.executeCommand('eds-guide.checkDependencies');
        }
      },
      null,
      this._disposables
  );

  }
  
  private _update(section: any) {
    const webview = this._panel.webview;
    this._panel.title = `Guide: ${section.title}`;
    this._panel.webview.html = this._getHtmlForWebview(webview, section);
  }
  
  private async _openNotebook(notebookPath: string) {
    if (vscode.workspace.workspaceFolders) {
      const rootUri = vscode.workspace.workspaceFolders[0].uri;
      const fileUri = vscode.Uri.joinPath(rootUri, notebookPath);
      try {
        await vscode.commands.executeCommand('vscode.open', fileUri);
      } catch (e) {
        console.error(e);
        vscode.window.showErrorMessage(`Could not open notebook: ${fileUri.fsPath}`);
      }
    }
  }

  // 🔴 CRITICAL UPDATE: New Layout and CSS
  private _getHtmlForWebview(webview: vscode.Webview, section: any) {
    const md = new MarkdownIt();
    const nonce = getNonce();
    let markdownContent = '';
    let notebookButton = '';
    let depsButton = '';
    
    // 1. EXTRACT TITLES
    // If we passed the categoryTitle, use it. Otherwise default.
    const eyebrow = section.categoryTitle ? section.categoryTitle.toUpperCase() : "ENVIRONMENTAL DATA SCIENCE";
    const title = section.title;

    // 2. GENERATE CHECK DEPENDENCIES BUTTON (Only for Setup)
    if (title.includes("Preparing your environment") || title.includes("1.1")) {
      depsButton = `
        <button class="action-btn deps-btn" id="check-deps-btn">
             <span class="icon">⚡</span> 
             <span>Check Environment Dependencies</span>
        </button>
      `;
    }

    // 3. GENERATE OPEN NOTEBOOK BUTTON
    if (section.notebook) {
      notebookButton = `
        <button class="action-btn notebook-btn" data-notebook="${section.notebook}">
            <span class="icon">📘</span>
            <span>Open Practical Notebook</span>
        </button>
      `;
    }

    // 4. GENERATE MARKDOWN CONTENT
    if (section.file) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        markdownContent = "<p>No workspace folder found.</p>";
      } else {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const mdPath = path.join(workspaceRoot, section.file);
        
        if (fs.existsSync(mdPath)) {
            markdownContent = fs.readFileSync(mdPath, 'utf8');
            markdownContent = md.render(markdownContent);
        } else {
            markdownContent = `<p style="color:red">File not found: ${mdPath}</p>`;
        }
      }
    } else {
      markdownContent = `<p>${section.description}</p>`;
    }

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${title}</title>
          <style>
              :root {
                  --container-paddding: 20px;
              }

              body {
                  font-family: var(--vscode-font-family, "Segoe UI", "Helvetica Neue", sans-serif);
                  font-size: 15px;
                  line-height: 1.6;
                  color: var(--vscode-editor-foreground);
                  background-color: var(--vscode-editor-background);
                  padding: 40px;
                  max-width: 800px;
                  margin: 0 auto;
              }

              /* --- TYPOGRAPHY --- */
              .eyebrow {
                  font-size: 0.85em;
                  font-weight: 600;
                  letter-spacing: 1px;
                  color: var(--vscode-descriptionForeground);
                  margin-bottom: 5px;
                  text-transform: uppercase;
              }

              h1 {
                  font-size: 2.2em;
                  font-weight: 700;
                  margin-top: 0;
                  margin-bottom: 25px;
                  color: var(--vscode-editor-foreground);
                  border: none;
              }

              h2 { margin-top: 30px; font-weight: 600; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 5px;}
              h3 { margin-top: 25px; font-weight: 600; }
              p { margin-bottom: 15px; }

              /* --- BUTTONS --- */
              .button-container {
                  display: flex;
                  flex-direction: column; /* Stack vertically */
                  gap: 12px;
                  margin-bottom: 40px;
                  border-bottom: 1px solid var(--vscode-widget-border);
                  padding-bottom: 30px;
              }

              .action-btn {
                  display: flex;
                  align-items: center;
                  gap: 10px;
                  padding: 12px 20px;
                  border: none;
                  border-radius: 6px;
                  font-size: 14px;
                  font-weight: 600;
                  cursor: pointer;
                  text-align: left;
                  transition: transform 0.1s ease, background 0.2s;
                  width: fit-content;
                  min-width: 250px;
              }

              .action-btn:active { transform: scale(0.98); }

              /* Primary Button (Notebook) - Blue */
              .notebook-btn {
                  background-color: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
              }
              .notebook-btn:hover { background-color: var(--vscode-button-hoverBackground); }

              /* Secondary Button (Dependencies) - Grey/Green tint */
              .deps-btn {
                  background-color: var(--vscode-button-secondaryBackground);
                  color: var(--vscode-button-secondaryForeground);
              }
              .deps-btn:hover { background-color: var(--vscode-button-secondaryHoverBackground); }

              .icon { font-size: 1.2em; }

              /* --- CODE BLOCKS --- */
              code {
                  font-family: var(--vscode-editor-font-family, "Consolas", monospace);
                  background-color: var(--vscode-textBlockQuote-background);
                  padding: 2px 5px;
                  border-radius: 4px;
                  font-size: 0.9em;
              }
              
              pre {
                  background-color: var(--vscode-textBlockQuote-background);
                  padding: 15px;
                  border-radius: 8px;
                  overflow-x: auto;
              }

              a { color: var(--vscode-textLink-foreground); text-decoration: none; }
              a:hover { text-decoration: underline; }

          </style>
      </head>
      <body>
          
          <div class="eyebrow">${eyebrow}</div>
          <h1>${title}</h1>

          <div class="button-container">
             ${depsButton}
             ${notebookButton}
          </div>

          <div class="content">
              ${markdownContent} 
          </div>

          <script nonce="${nonce}">
              const vscode = acquireVsCodeApi();

              // Setup Listeners
              const depsBtn = document.getElementById('check-deps-btn');
              if (depsBtn) {
                  depsBtn.addEventListener('click', () => {
                      vscode.postMessage({ command: 'checkDependencies' });
                  });
              }

              const nbBtn = document.querySelector('.notebook-btn');
              if (nbBtn) {
                  nbBtn.addEventListener('click', () => {
                      const notebookPath = nbBtn.getAttribute('data-notebook');
                      vscode.postMessage({
                          command: 'openNotebook',
                          notebook: notebookPath
                      });
                  });
              }
          </script>
      </body>
      </html>`;
  }

  public dispose() {
    SectionWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function deactivate() {}