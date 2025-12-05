import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
const MarkdownIt = require('markdown-it'); // Use the 'require' import

// This function is called when your extension is first activated
export function activate(context: vscode.ExtensionContext) {
  
  // Create a new TreeDataProvider and register it
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
}

//##############################################################################
// 1. THE NAVIGATION LIST (TreeDataProvider)
// This class reads your JSON files and builds the sidebar list
//##############################################################################
class CourseOutlineProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private extensionPath: string) {}

  // This is required, but we don't need it
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  // This is the main function that builds the tree
  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    
    // If we are at the top level, return the main categories
    if (!element) {
      return Promise.resolve([
        new SectionItem("Module Practicals", "A list of all course practicals", vscode.TreeItemCollapsibleState.Expanded, "practicals"),
        new SectionItem("Assignments", "A list of all assignments", vscode.TreeItemCollapsibleState.Expanded, "assignments"),
      ]);
    }

    // If we are under "Practicals", read toc.json
    if (element.id === "practicals") {
      const tocPath = path.join(this.extensionPath, '.guide', 'toc.json');
      const toc = JSON.parse(fs.readFileSync(tocPath, 'utf8'));
      
      let practicalSections: SectionItem[] = [];
      toc.categories.forEach((category: any) => {
        // Add the category as a collapsible item
        const categoryItem = new SectionItem(
          category.title,
          category.description,
          vscode.TreeItemCollapsibleState.Expanded,
          category.title
        );
        practicalSections.push(categoryItem);

        // Add the steps under the category
        category.steps.forEach((step: any) => {
          const stepItem = new SectionItem(
            step.title,
            step.description,
            vscode.TreeItemCollapsibleState.None, // This item is not collapsible
            step.title
          );
          // This is the command that will be run when the item is clicked
          stepItem.command = {
            command: 'eds-guide.openSection',
            title: 'Open Guide Section',
            arguments: [step], // Pass the 'step' object to our command
          };
          practicalSections.push(stepItem);
        });
      });
      return Promise.resolve(practicalSections);
    }

    // If we are under "Assignments", read assignments.json
    if (element.id === "assignments") {
      const assignPath = path.join(this.extensionPath, '.guide', 'assignments.json');
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
          arguments: [assign], // Pass the 'assign' object to our command
        };
        return assignItem;
      });
      return Promise.resolve(assignmentSections);
    }

    return Promise.resolve([]);
  }
}

// A helper class to define our TreeItems
class SectionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    description: string, // <-- PROBLEM SOLVED
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly id?: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.label} - ${description}`;
    this.description = description; // This now correctly sets the public property
  }
}

//##############################################################################
// 2. THE MAIN EDITOR TAB (WebviewPanel)
// This class creates the "Building Machine Learning Systems" tab
//##############################################################################
class SectionWebviewPanel {
  public static currentPanel: SectionWebviewPanel | undefined;
  public static readonly viewType = 'edsGuideSection';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _extensionPath: string;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, extensionPath: string, section: any) {
    // If we already have a panel, show it.
    if (SectionWebviewPanel.currentPanel) {
      SectionWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      SectionWebviewPanel.currentPanel._update(section);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      SectionWebviewPanel.viewType,
      `Guide: ${section.title}`, // This is the tab title
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

    // Set the webview's initial content
    this._update(section);

    // Listen for when the panel is closed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview (e.g., button clicks)
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'openNotebook') {
          this._openNotebook(message.notebook);
        }
      },
      null,
      this._disposables
    );
  }
  
  // This updates the content of the tab
  private _update(section: any) {
    const webview = this._panel.webview;
    this._panel.title = `Guide: ${section.title}`;
    this._panel.webview.html = this._getHtmlForWebview(webview, section);
  }
  
  // Helper function to open a notebook
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

  // This generates the HTML for the main editor tab
  private _getHtmlForWebview(webview: vscode.Webview, section: any) {
    const md = new MarkdownIt();
    const nonce = getNonce();
    let markdownContent = '';
    let notebookButton = '';
    
    // Check if it's a practical (has 'file') or an assignment (no 'file')
    if (section.file) {
      // It's a practical, so read the .md file
      const mdPath = path.join(this._extensionPath, section.file);
      markdownContent = fs.readFileSync(mdPath, 'utf8');
      markdownContent = md.render(markdownContent); // Convert markdown to HTML
    } else {
      // It's an assignment, so just show the description
      markdownContent = `<p>${section.description}</p>`;
    }
    
    // If a notebook path is provided, add the button
    if (section.notebook) {
      notebookButton = `
        <button class="open-notebook-btn" data-notebook="${section.notebook}">
            Open Notebook/Practical
        </button>
      `;
    }

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${section.title}</title>
          <style>
              body { 
    /* This is the explicit font stack VS Code uses for its UI */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";

    /* We set a default size and weight */
    font-weight: normal;
    font-size: 10px;

    padding: 20px; 
    color: var(--vscode-editor-foreground);
    background-color: var(--vscode-editor-background);
}
              h1 { 
                  color: var(--vscode-textLink-foreground);
                  border-bottom: 1px solid var(--vscode-separator-foreground);
                  padding-bottom: 10px;
              }
              .open-notebook-btn {
                  background-color: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
                  border: none;
                  padding: 10px 15px;
                  border-radius: 4px;
                  cursor: pointer;
                  font-weight: bold;
                  font-size: 1.1em;
                  margin: 10px 0 20px 0;
              }
              .open-notebook-btn:hover {
                  background-color: var(--vscode-button-hoverBackground);
              }
              code {
                  background-color: var(--vscode-textBlockQuote-background);
                  padding: 2px 4px;
                  border-radius: 3px;
              }
              pre {
                  background-color: var(--vscode-textBlockQuote-background);
                  padding: 10px;
                  border-radius: 4px;
              }
          </style>
      </head>
      <body>
          <h1>${section.title}</h1>
          ${notebookButton}
          <hr>
          ${markdownContent} 

          <script nonce="${nonce}">
              const vscode = acquireVsCodeApi();
              const button = document.querySelector('.open-notebook-btn');
              if (button) {
                  button.addEventListener('click', () => {
                      const notebookPath = button.getAttribute('data-notebook');
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

// Helper function to generate a random "nonce" for security
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function deactivate() {}