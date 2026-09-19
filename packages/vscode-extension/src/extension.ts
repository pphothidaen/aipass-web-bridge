import * as vscode from 'vscode';
import { relative, basename } from 'node:path';
import { BridgeClient } from '@aipass/shared';
import { AipassViewProvider } from './ui/aipassViewProvider';
import { getProjectContext } from './core/context';
import { recordContextAccess } from './core/audit';

function getClient(): BridgeClient {
  const baseUrl = vscode.workspace.getConfiguration('aipass').get<string>('bridgeUrl', 'https://aipass-web-bridge.taijustarrett417.workers.dev');
  return new BridgeClient(baseUrl);
}

function getBridgeUrl(): string {
  return vscode.workspace.getConfiguration('aipass').get<string>('bridgeUrl', 'https://aipass-web-bridge.taijustarrett417.workers.dev');
}

async function isBridgeRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${getBridgeUrl()}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('AiPASS');
  const extensionVersion = String(context.extension?.packageJSON?.version || '0.1.30');
  const provider = new AipassViewProvider(
    context.extensionUri,
    getClient,
    getProjectContext,
    details => void recordContextAccess(context, details),
    undefined,
    extensionVersion,
    context.workspaceState,
    context.globalState,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AipassViewProvider.viewType, provider)
  );

  const originalContentProvider = new class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      const pathKey = decodeURIComponent(uri.query);
      const backup = provider.getBackup(pathKey);
      return backup?.originalContent ?? '';
    }
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('aipass-original', originalContentProvider)
  );

  const startBridge = vscode.commands.registerCommand('aipass.startBridge', async () => {
    vscode.window.showInformationMessage('AiPASS: ไม่มี local bridge แล้ว ใช้ Cloudflare Worker โดยตรง ผ่าน aipass.bridgeUrl');
  });

  const testConnection = vscode.commands.registerCommand('aipass.testConnection', async () => {
    const client = getClient();
    output.show(true);
    output.appendLine('กำลังเชื่อมต่อ bridge...');
    try {
      const models = await client.listModels();
      output.appendLine(`เชื่อมต่อสำเร็จ! พบ ${models.length} models`);
      models.slice(0, 5).forEach(m => output.appendLine(` - ${m.id}`));
      vscode.window.showInformationMessage(`AiPASS bridge เชื่อมต่อสำเร็จ: ${models.length} models`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.appendLine(`ล้มเหลว: ${message}`);
      vscode.window.showErrorMessage(`เชื่อมต่อ AiPASS bridge ไม่ได้: ${message}`);
    }
  });

  const ask = vscode.commands.registerCommand('aipass.ask', async () => {
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.document.getText(editor.selection) ?? '';
    const question = await vscode.window.showInputBox({
      prompt: 'ถาม AiPASS เกี่ยวกับโค้ดนี้',
      value: selection ? `เกี่ยวกับโค้ดนี้:\n${selection}\n\nคำถาม: ` : '',
    });
    if (!question) return;
    const client = getClient();
    output.show(true);
    output.appendLine(`> ${question}`);
    try {
      const projectContext = getProjectContext();
      void recordContextAccess(context, { model: undefined, sections: projectContext.sections });
      const res = await client.chatCompletion({
        messages: [
          { role: 'user', content: projectContext.text ? `${projectContext.text}\n\nคำถามจาก VS Code:\n${question}` : question },
        ],
      });
      const answer = res.choices?.[0]?.message?.content ?? '(ไม่มีคำตอบ)';
      output.appendLine(answer);
    } catch (err: any) {
      output.appendLine(`ล้มเหลว: ${err.message}`);
      vscode.window.showErrorMessage(`AiPASS ask ล้มเหลว: ${err.message}`);
    }
  });

  const generateUnitTest = vscode.commands.registerCommand('aipass.generateUnitTest', async (uri?: vscode.Uri) => {
    let targetUri = uri;
    if (!targetUri && vscode.window.activeTextEditor) {
      targetUri = vscode.window.activeTextEditor.document.uri;
    }

    let prompt: string;
    if (targetUri && targetUri.scheme === 'file') {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
      const relativePath = workspaceFolder
        ? relative(workspaceFolder.uri.fsPath, targetUri.fsPath)
        : basename(targetUri.fsPath);
      prompt = `/test เขียน Unit Test ที่ครอบคลุมสำหรับไฟล์ ${relativePath} พร้อมสร้าง/บันทึกไฟล์ test และใช้ run_terminal_command เพื่อรันเทสให้ผ่านทั้งหมด`;
    } else {
      prompt = `/test เขียน Unit Test ที่ครอบคลุมสำหรับโค้ดใน active file พร้อมสร้าง/บันทึกไฟล์ test และใช้ run_terminal_command เพื่อรันเทสให้ผ่านทั้งหมด`;
    }

    await provider.sendPromptFromCommand(prompt);
  });

  const runCheckLocally = vscode.commands.registerCommand('aipass.runCheckLocally', async () => {
    vscode.window.showInformationMessage('AiPASS: Run Check Locally — ยังไม่ได้เชื่อมกับ checks-runner (ทำ step ถัดไป)');
  });

  const openSidebar = vscode.commands.registerCommand('aipass.openSidebar', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.aipass-sidebar');
  });

  context.subscriptions.push(startBridge, testConnection, ask, generateUnitTest, runCheckLocally, openSidebar, output);
}

export function deactivate() {
  // no local bridge to stop
}