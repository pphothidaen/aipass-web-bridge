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
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const shared_1 = require("./shared");
const aipassViewProvider_1 = require("./ui/aipassViewProvider");
const context_1 = require("./core/context");
const audit_1 = require("./core/audit");
let bridgeProcess;
let bridgeStartPromise;
function getClient() {
    const baseUrl = vscode.workspace.getConfiguration('aipass').get('bridgeUrl', 'http://127.0.0.1:8787');
    return new shared_1.BridgeClient(baseUrl);
}
function getBridgeUrl() {
    return vscode.workspace.getConfiguration('aipass').get('bridgeUrl', 'http://127.0.0.1:8787');
}
function getBridgeServerPath(context) {
    const configuredPath = vscode.workspace.getConfiguration('aipass').get('bridgePath', '').trim();
    const candidates = configuredPath
        ? [configuredPath]
        : [
            (0, node_path_1.resolve)(context.extensionPath, 'out/bridge/server.mjs'),
            (0, node_path_1.resolve)(context.extensionPath, '../core/aipass-bridge/bridge'),
            ...(vscode.workspace.workspaceFolders ?? []).map(folder => (0, node_path_1.resolve)(folder.uri.fsPath, 'packages/core/aipass-bridge/bridge')),
        ];
    for (const directory of candidates) {
        const serverPath = directory.endsWith('.mjs') ? directory : (0, node_path_1.join)(directory, 'server.mjs');
        if ((0, node_fs_1.existsSync)(serverPath))
            return serverPath;
    }
    return undefined;
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
async function waitForBridge() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await isBridgeRunning())
            return true;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    }
    return false;
}
async function startBridgeServer(context, output, notify) {
    if (await isBridgeRunning()) {
        if (notify)
            vscode.window.showInformationMessage('AiPASS bridge กำลังทำงานอยู่แล้ว');
        return true;
    }
    if (bridgeStartPromise)
        return bridgeStartPromise;
    bridgeStartPromise = (async () => {
        const serverPath = getBridgeServerPath(context);
        if (!serverPath) {
            if (notify) {
                const action = await vscode.window.showErrorMessage('ไม่พบ embedded AiPASS app server', 'ตั้งค่า aipass.bridgePath');
                if (action)
                    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pphothidaen.aipass-vscode-extension aipass.bridgePath');
            }
            return false;
        }
        const storagePath = context.globalStorageUri.fsPath;
        (0, node_fs_1.mkdirSync)(storagePath, { recursive: true });
        output.show(true);
        output.appendLine(`กำลังเริ่ม embedded app server: ${serverPath}`);
        bridgeProcess = (0, node_child_process_1.spawn)(process.execPath, [serverPath], {
            cwd: storagePath,
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                AIPASS_MODEL_CACHE_FILE: (0, node_path_1.join)(storagePath, 'models.json'),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        bridgeProcess.stdout?.on('data', data => output.append(data.toString()));
        bridgeProcess.stderr?.on('data', data => output.append(data.toString()));
        bridgeProcess.once('error', (error) => {
            output.appendLine(`เริ่ม app server ไม่สำเร็จ: ${error.message}`);
            bridgeProcess = undefined;
        });
        bridgeProcess.once('exit', () => {
            bridgeProcess = undefined;
        });
        const running = await waitForBridge();
        if (notify) {
            if (running)
                vscode.window.showInformationMessage('AiPASS app server เริ่มทำงานแล้ว');
            else
                vscode.window.showErrorMessage('เริ่ม AiPASS app server แล้ว แต่ยังเชื่อมต่อไม่ได้ ดูรายละเอียดในช่อง AiPASS');
        }
        return running;
    })().finally(() => {
        bridgeStartPromise = undefined;
    });
    return bridgeStartPromise;
}
function activate(context) {
    const output = vscode.window.createOutputChannel('AiPASS');
    const extensionVersion = String(context.extension?.packageJSON?.version || '0.1.30');
    const provider = new aipassViewProvider_1.AipassViewProvider(context.extensionUri, getClient, context_1.getProjectContext, details => void (0, audit_1.recordContextAccess)(context, details), () => startBridgeServer(context, output, false), extensionVersion, context.workspaceState, context.globalState);
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
    void startBridgeServer(context, output, false);
}
function deactivate() {
    bridgeProcess?.kill();
    bridgeProcess = undefined;
}
