import * as vscode from 'vscode';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { ChildProcess, spawn } from 'node:child_process';
import { BridgeClient } from '@aipass/shared';
import { AipassViewProvider } from './ui/aipassViewProvider';
import { getProjectContext } from './core/context';
import { recordContextAccess } from './core/audit';

let bridgeProcess: ChildProcess | undefined;
let bridgeStartPromise: Promise<boolean> | undefined;

function getClient(): BridgeClient {
  const baseUrl = vscode.workspace.getConfiguration('aipass').get<string>('bridgeUrl', 'http://127.0.0.1:8787');
  return new BridgeClient(baseUrl);
}

function getBridgeUrl(): string {
  return vscode.workspace.getConfiguration('aipass').get<string>('bridgeUrl', 'http://127.0.0.1:8787');
}

function getBridgeServerPath(context: vscode.ExtensionContext): string | undefined {
  const configuredPath = vscode.workspace.getConfiguration('aipass').get<string>('bridgePath', '').trim();
  const candidates = configuredPath
    ? [configuredPath]
    : [
      resolve(context.extensionPath, 'out/bridge/server.mjs'),
        resolve(context.extensionPath, '../core/aipass-bridge/bridge'),
        ...(vscode.workspace.workspaceFolders ?? []).map(folder =>
          resolve(folder.uri.fsPath, 'packages/core/aipass-bridge/bridge')
        ),
      ];

  for (const directory of candidates) {
    const serverPath = directory.endsWith('.mjs') ? directory : join(directory, 'server.mjs');
    if (existsSync(serverPath)) return serverPath;
  }
  return undefined;
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

async function waitForBridge(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isBridgeRunning()) return true;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  return false;
}

async function startBridgeServer(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  notify: boolean,
): Promise<boolean> {
  if (await isBridgeRunning()) {
    if (notify) vscode.window.showInformationMessage('AiPASS bridge กำลังทำงานอยู่แล้ว');
    return true;
  }
  if (bridgeStartPromise) return bridgeStartPromise;

  bridgeStartPromise = (async () => {
    const serverPath = getBridgeServerPath(context);
    if (!serverPath) {
      if (notify) {
        const action = await vscode.window.showErrorMessage(
          'ไม่พบ embedded AiPASS app server',
          'ตั้งค่า aipass.bridgePath'
        );
        if (action) await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pphothidaen.aipass-vscode-extension aipass.bridgePath');
      }
      return false;
    }

    const storagePath = context.globalStorageUri.fsPath;
    mkdirSync(storagePath, { recursive: true });
    output.show(true);
    output.appendLine(`กำลังเริ่ม embedded app server: ${serverPath}`);
    bridgeProcess = spawn(process.execPath, [serverPath], {
      cwd: storagePath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AIPASS_MODEL_CACHE_FILE: join(storagePath, 'models.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    bridgeProcess.stdout?.on('data', data => output.append(data.toString()));
    bridgeProcess.stderr?.on('data', data => output.append(data.toString()));
    bridgeProcess.once('error', (error: Error) => {
      output.appendLine(`เริ่ม app server ไม่สำเร็จ: ${error.message}`);
      bridgeProcess = undefined;
    });
    bridgeProcess.once('exit', () => {
      bridgeProcess = undefined;
    });

    const running = await waitForBridge();
    if (notify) {
      if (running) vscode.window.showInformationMessage('AiPASS app server เริ่มทำงานแล้ว');
      else vscode.window.showErrorMessage('เริ่ม AiPASS app server แล้ว แต่ยังเชื่อมต่อไม่ได้ ดูรายละเอียดในช่อง AiPASS');
    }
    return running;
  })().finally(() => {
    bridgeStartPromise = undefined;
  });

  return bridgeStartPromise;
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('AiPASS');
  const extensionVersion = String(context.extension?.packageJSON?.version || '0.1.30');
  const provider = new AipassViewProvider(
    context.extensionUri,
    getClient,
    getProjectContext,
    details => void recordContextAccess(context, details),
    () => startBridgeServer(context, output, false),
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
    await startBridgeServer(context, output, true);
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
  void startBridgeServer(context, output, false);
}

export function deactivate() {
  bridgeProcess?.kill();
  bridgeProcess = undefined;
}