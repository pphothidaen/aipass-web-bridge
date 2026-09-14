import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);
const CORE_PATH = path.join(__dirname, '../../core/aipass-bridge');

async function askAipass(message: string): Promise<string> {
  // เรียก bridge เดิมตรงๆ ผ่าน CLI ที่มีอยู่แล้ว
  const escaped = message.replace(/"/g, '\\"');
  const { stdout } = await execAsync(
    `npm run chat -- --message "${escaped}"`,
    { cwd: CORE_PATH, maxBuffer: 1024 * 1024 * 10 }
  );
  return stdout;
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('AiPASS Dev Suite');

  context.subscriptions.push(
    vscode.commands.registerCommand('aipass.ask', async () => {
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.document.getText(editor.selection) || '';
      const question = await vscode.window.showInputBox({
        prompt: 'ถาม AiPASS เกี่ยวกับโค้ดนี้',
        value: selection ? `เกี่ยวกับโค้ดนี้:\n${selection}\n\nคำถาม: ` : ''
      });
      if (!question) return;

      output.show(true);
      output.appendLine(`> ${question}`);
      try {
        const answer = await askAipass(question);
        output.appendLine(answer);
      } catch (err: any) {
        vscode.window.showErrorMessage(`AiPASS error: ${err.message}. ลองรัน "npm run doctor" ใน core ดูก่อน`);
      }
    })
  );
}

export function deactivate() {}