"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const node_path_1 = require("node:path");
const shared_1 = require("./shared");
const aipassViewProvider_1 = require("./ui/aipassViewProvider");
const context_1 = require("./core/context");
const audit_1 = require("./core/audit");
function getClient() {
    const baseUrl = vscode.workspace.getConfiguration('aipass').get('bridgeUrl', 'https://aipass-web-bridge.taijustarrett417.workers.dev');
    return new shared_1.BridgeClient(baseUrl);
}
function getBridgeUrl() {
    return vscode.workspace.getConfiguration('aipass').get('bridgeUrl', 'https://aipass-web-bridge.taijustarrett417.workers.dev');
}
async function isBridgeRunning() {
    try {
        const response = await fetch(`${getBridgeUrl()}/health`, {
            signal: AbortSignal.timeout(1000),
        });
        return response.ok;
    }
    catch {
        return false;
    }
}
function activate(context) {
    const output = vscode.window.createOutputChannel('AiPASS');
    const extensionVersion = String(context.extension?.packageJSON?.version || '0.1.30');
    const provider = new aipassViewProvider_1.AipassViewProvider(context.extensionUri, getClient, context_1.getProjectContext, details => void (0, audit_1.recordContextAccess)(context, details), undefined, extensionVersion, context.workspaceState, context.globalState);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(aipassViewProvider_1.AipassViewProvider.viewType, provider));
    const originalContentProvider = new class {
        provideTextDocumentContent(uri) {
            const pathKey = decodeURIComponent(uri.query);
            const backup = provider.getBackup(pathKey);
            return backup?.originalContent ?? '';
        }
    };
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('aipass-original', originalContentProvider));
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
        }
        catch (err) {
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
        if (!question)
            return;
        const client = getClient();
        output.show(true);
        output.appendLine(`> ${question}`);
        try {
            const projectContext = (0, context_1.getProjectContext)();
            void (0, audit_1.recordContextAccess)(context, { model: undefined, sections: projectContext.sections });
            const res = await client.chatCompletion({
                messages: [
                    { role: 'user', content: projectContext.text ? `${projectContext.text}\n\nคำถามจาก VS Code:\n${question}` : question },
                ],
            });
            const answer = res.choices?.[0]?.message?.content ?? '(ไม่มีคำตอบ)';
            output.appendLine(answer);
        }
        catch (err) {
            output.appendLine(`ล้มเหลว: ${err.message}`);
            vscode.window.showErrorMessage(`AiPASS ask ล้มเหลว: ${err.message}`);
        }
    });
    const generateUnitTest = vscode.commands.registerCommand('aipass.generateUnitTest', async (uri) => {
        let targetUri = uri;
        if (!targetUri && vscode.window.activeTextEditor) {
            targetUri = vscode.window.activeTextEditor.document.uri;
        }
        let prompt;
        if (targetUri && targetUri.scheme === 'file') {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
            const relativePath = workspaceFolder
                ? (0, node_path_1.relative)(workspaceFolder.uri.fsPath, targetUri.fsPath)
                : (0, node_path_1.basename)(targetUri.fsPath);
            prompt = `/test เขียน Unit Test ที่ครอบคลุมสำหรับไฟล์ ${relativePath} พร้อมสร้าง/บันทึกไฟล์ test และใช้ run_terminal_command เพื่อรันเทสให้ผ่านทั้งหมด`;
        }
        else {
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
function deactivate() {
    // no local bridge to stop
}
