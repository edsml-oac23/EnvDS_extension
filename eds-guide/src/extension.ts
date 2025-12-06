import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {

  const provider = new EdsGuideSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('eds-guide.courseOutlineView', provider)
  );

  // Commands
  let disposable = vscode.commands.registerCommand('eds-guide.checkDependencies', () => {
    vscode.commands.executeCommand('workbench.action.terminal.focus');
    vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: 'uv --version && just --version && docker ps\n'
    });
  });

  context.subscriptions.push(disposable);
}

class EdsGuideSidebarProvider implements vscode.WebviewViewProvider {
  public _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.command) {
        case 'checkDependencies':
          vscode.commands.executeCommand('eds-guide.checkDependencies');
          break;
        case 'openSection':
          const uri = vscode.Uri.joinPath(this.context.extensionUri, '.guide', message.path);
          vscode.commands.executeCommand('markdown.showPreview', uri);
          break;
      }
    });
  }

  private getHtmlContent(): string {
    const htmlPath = path.join(this.context.extensionPath, 'src', 'webview', 'sidebarView.html');
    return fs.readFileSync(htmlPath, 'utf8');
  }
}