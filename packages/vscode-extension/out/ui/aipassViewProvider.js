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
exports.AipassViewProvider = void 0;
exports.getWorkspaceDiagnostics = getWorkspaceDiagnostics;
// src/ui/aipassViewProvider.ts
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const bridge_1 = require("../core/bridge");
const context_1 = require("../core/context");
const tools_1 = require("../core/tools");
function getWorkspaceDiagnostics(targetFilePath) {
    const allDiagnostics = vscode.languages.getDiagnostics();
    const results = [];
    for (const [uri, diags] of allDiagnostics) {
        if (diags.length === 0)
            continue;
        const fsPath = uri.fsPath;
        if (targetFilePath && !fsPath.toLowerCase().includes(targetFilePath.toLowerCase())) {
            continue;
        }
        const relevant = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning);
        if (relevant.length === 0)
            continue;
        const rel = vscode.workspace.asRelativePath(uri);
        const diagLines = relevant.map(d => {
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
            const line = d.range.start.line + 1;
            const col = d.range.start.character + 1;
            const source = d.source ? `[${d.source}] ` : '';
            return `  - Line ${line}:${col} [${sev}] ${source}${d.message}`;
        });
        results.push(`File: ${rel}\n${diagLines.join('\n')}`);
    }
    if (results.length === 0) {
        return targetFilePath
            ? `No active errors or warnings found in '${targetFilePath}'.`
            : 'No active errors or warnings found across the workspace.';
    }
    return `Found diagnostics (${results.length} files affected):\n\n${results.join('\n\n')}`;
}
function escapeHtmlText(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
class AipassViewProvider {
    constructor(_extensionUri, _getClient, _getContext, _onContextUsed, _startBridge, _extensionVersion = '0.1.30', _workspaceState, _globalState) {
        this._extensionUri = _extensionUri;
        this._getClient = _getClient;
        this._getContext = _getContext;
        this._onContextUsed = _onContextUsed;
        this._startBridge = _startBridge;
        this._extensionVersion = _extensionVersion;
        this._workspaceState = _workspaceState;
        this._globalState = _globalState;
        this._modifiedFiles = new Map();
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
            if (folder && fs.existsSync(folder.uri.fsPath)) {
                this._lastActiveWorkspaceFolder = folder.uri.fsPath;
            }
        }
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
                if (folder && fs.existsSync(folder.uri.fsPath)) {
                    this._lastActiveWorkspaceFolder = folder.uri.fsPath;
                }
            }
        });
    }
    getCachedModels() {
        const cached = this._globalState?.get('aipass.cachedModels');
        if (Array.isArray(cached) && cached.length > 0) {
            return cached;
        }
        return tools_1.DEFAULT_FALLBACK_MODELS;
    }
    async saveCachedModels(models) {
        if (this._globalState && Array.isArray(models) && models.length > 0) {
            await this._globalState.update('aipass.cachedModels', models);
        }
    }
    getCurrentProjectDefaultPath() {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
            if (folder && fs.existsSync(folder.uri.fsPath)) {
                this._lastActiveWorkspaceFolder = folder.uri.fsPath;
                return folder.uri.fsPath;
            }
        }
        if (this._lastActiveWorkspaceFolder && fs.existsSync(this._lastActiveWorkspaceFolder)) {
            return this._lastActiveWorkspaceFolder;
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0 && fs.existsSync(folders[0].uri.fsPath)) {
            return folders[0].uri.fsPath;
        }
        return (0, context_1.getAgentBasePath)();
    }
    getEffectiveBasePath(explicitPath) {
        const trimmed = explicitPath?.trim();
        if (trimmed) {
            return trimmed;
        }
        const saved = this._workspaceState?.get('aipass.targetPath')?.trim();
        if (saved && fs.existsSync(saved)) {
            return saved;
        }
        return this.getCurrentProjectDefaultPath();
    }
    getBackup(pathKey) {
        return this._modifiedFiles.get(pathKey);
    }
    async sendPromptFromCommand(promptText) {
        if (!this._view) {
            this._pendingPrompt = promptText;
            await vscode.commands.executeCommand('aipass.openSidebar');
            return;
        }
        this._view.show?.(true);
        await this._view.webview.postMessage({
            type: 'triggerPrompt',
            text: promptText,
        });
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        if (this._pendingPrompt) {
            const prompt = this._pendingPrompt;
            this._pendingPrompt = undefined;
            setTimeout(() => {
                this._view?.webview.postMessage({
                    type: 'triggerPrompt',
                    text: prompt,
                });
            }, 400);
        }
        const chatCss = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const scriptUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js'));
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };
        webviewView.webview.html = this._getHtmlContent(chatCss, scriptUri);
        const refreshModels = async (showNotification = false) => {
            try {
                const models = await this._getClient().listModels();
                if (models && models.length > 0) {
                    await this.saveCachedModels(models);
                    await webviewView.webview.postMessage({ type: 'setModels', models, fromRefresh: true });
                    if (showNotification) {
                        vscode.window.showInformationMessage(`อัปเดตรายการโมเดลสำเร็จ พบ ${models.length} โมเดล`);
                    }
                    return;
                }
            }
            catch (error) {
                if (this._startBridge) {
                    try {
                        const started = await this._startBridge();
                        if (started) {
                            const retriedModels = await this._getClient().listModels();
                            if (retriedModels && retriedModels.length > 0) {
                                await this.saveCachedModels(retriedModels);
                                await webviewView.webview.postMessage({ type: 'setModels', models: retriedModels, fromRefresh: true });
                                if (showNotification) {
                                    vscode.window.showInformationMessage(`เริ่ม Bridge และอัปเดตโมเดลสำเร็จ (${retriedModels.length} โมเดล)`);
                                }
                                return;
                            }
                        }
                    }
                    catch {
                        // ignore
                    }
                }
                const cached = this.getCachedModels();
                await webviewView.webview.postMessage({
                    type: 'modelsError',
                    message: error instanceof Error ? error.message : 'เชื่อมต่อ Bridge ไม่สำเร็จ',
                    fallbackModels: cached,
                });
                if (showNotification) {
                    vscode.window.showWarningMessage(`ไม่สามารถรีเฟรชโมเดลจาก Bridge ได้: ${error instanceof Error ? error.message : String(error)}`);
                }
                return;
            }
        };
        // Immediately send cached models and default base path to webview without network wait
        const initialCachedModels = this.getCachedModels();
        void webviewView.webview.postMessage({
            type: 'setModels',
            models: initialCachedModels,
        });
        const defaultBasePath = this.getEffectiveBasePath();
        const initialMode = this._workspaceState?.get('aipass.mode') || 'agent';
        void webviewView.webview.postMessage({
            type: 'initData',
            basePath: defaultBasePath,
            mode: initialMode,
        });
        const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor)
                return;
            // Only update dynamically if user has not explicitly saved a custom target path for this project
            const saved = this._workspaceState?.get('aipass.targetPath')?.trim();
            if (!saved) {
                const currentDefault = this.getCurrentProjectDefaultPath();
                void webviewView.webview.postMessage({
                    type: 'setTargetPath',
                    path: currentDefault,
                });
            }
        });
        webviewView.onDidDispose(() => {
            activeEditorDisposable.dispose();
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'webviewReady') {
                const currentCached = this.getCachedModels();
                await webviewView.webview.postMessage({
                    type: 'setModels',
                    models: currentCached,
                });
                const currentBasePath = this.getEffectiveBasePath();
                const savedMode = this._workspaceState?.get('aipass.mode') || 'agent';
                await webviewView.webview.postMessage({
                    type: 'initData',
                    basePath: currentBasePath,
                    mode: savedMode,
                });
                return;
            }
            if (data.type === 'saveMode') {
                const modeVal = data.mode === 'chat' ? 'chat' : 'agent';
                if (this._workspaceState) {
                    await this._workspaceState.update('aipass.mode', modeVal);
                }
                return;
            }
            if (data.type === 'refreshModels') {
                await refreshModels(true);
                return;
            }
            if (data.type === 'saveTargetPath') {
                const newPath = String(data.path || '').trim();
                if (this._workspaceState) {
                    if (newPath) {
                        await this._workspaceState.update('aipass.targetPath', newPath);
                    }
                    else {
                        await this._workspaceState.update('aipass.targetPath', undefined);
                    }
                }
                return;
            }
            if (data.type === 'browseTargetPath') {
                const current = this.getEffectiveBasePath(String(data.currentPath || ''));
                const defaultUri = fs.existsSync(current) ? vscode.Uri.file(current) : undefined;
                const selected = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    defaultUri,
                    openLabel: 'เลือกโฟลเดอร์นี้เป็น Project Root',
                    title: 'เลือกโฟลเดอร์ Project Root สำหรับ AiPASS',
                });
                if (selected && selected[0]) {
                    const chosenPath = selected[0].fsPath;
                    if (this._workspaceState) {
                        await this._workspaceState.update('aipass.targetPath', chosenPath);
                    }
                    await webviewView.webview.postMessage({
                        type: 'setTargetPath',
                        path: chosenPath,
                    });
                    vscode.window.showInformationMessage(`ตั้งค่า Root โปรเจกต์เป็น: '${chosenPath}'`);
                }
                return;
            }
            if (data.type === 'resetTargetPath') {
                if (this._workspaceState) {
                    await this._workspaceState.update('aipass.targetPath', undefined);
                }
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    this._lastActiveWorkspaceFolder = undefined;
                }
                const defaultPath = this.getCurrentProjectDefaultPath();
                await webviewView.webview.postMessage({
                    type: 'setTargetPath',
                    path: defaultPath,
                });
                vscode.window.showInformationMessage(`รีโหลด Root กลับเป็นค่าเริ่มต้นโปรเจกต์: '${defaultPath}'`);
                return;
            }
            if (data.type === 'cancelAgent') {
                if (this._currentAbortController) {
                    this._currentAbortController.abort();
                    this._currentAbortController = undefined;
                }
                return;
            }
            if (data.type === 'openDiff') {
                const backup = this._modifiedFiles.get(data.path);
                if (!backup) {
                    vscode.window.showWarningMessage(`ไม่พบข้อมูลการแก้ไขสำหรับ ${data.path}`);
                    return;
                }
                const currentUri = vscode.Uri.file(backup.fullPath);
                if (backup.isNew || backup.originalContent === null) {
                    const doc = await vscode.workspace.openTextDocument(currentUri);
                    await vscode.window.showTextDocument(doc);
                }
                else {
                    const originalUri = currentUri.with({
                        scheme: 'aipass-original',
                        query: encodeURIComponent(data.path),
                    });
                    await vscode.commands.executeCommand('vscode.diff', originalUri, currentUri, `${data.path} (Original ↔ Agent Edit)`);
                }
                return;
            }
            if (data.type === 'revertFile') {
                const backup = this._modifiedFiles.get(data.path);
                if (!backup) {
                    vscode.window.showWarningMessage(`ไม่พบประวัติการแก้ไขของ ${data.path}`);
                    return;
                }
                try {
                    if (backup.isNew) {
                        if (fs.existsSync(backup.fullPath)) {
                            fs.unlinkSync(backup.fullPath);
                        }
                    }
                    else if (backup.originalContent !== null) {
                        fs.writeFileSync(backup.fullPath, backup.originalContent, 'utf8');
                    }
                    this._modifiedFiles.delete(data.path);
                    vscode.window.showInformationMessage(`ย้อนคืนค่า '${data.path}' สำเร็จ`);
                    await webviewView.webview.postMessage({
                        type: 'fileReverted',
                        path: data.path,
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`ย้อนคืนค่า ${data.path} ล้มเหลว: ${msg}`);
                }
                return;
            }
            if (data.type === 'openFile') {
                const targetPath = String(data.path || '').trim();
                const basePath = this.getEffectiveBasePath(data.targetPath);
                const { resolvedPath, error } = (0, tools_1.resolveSafePath)(basePath, targetPath);
                if (!error && fs.existsSync(resolvedPath)) {
                    try {
                        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
                        await vscode.window.showTextDocument(doc, { preview: false });
                    }
                    catch (e) {
                        vscode.window.showErrorMessage(`ไม่สามารถเปิดไฟล์ได้: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                else if (error) {
                    vscode.window.showErrorMessage(`ไม่สามารถเปิดไฟล์ได้: ${error}`);
                }
                return;
            }
            if (data.type === 'applyCodeToFile') {
                const targetPath = String(data.path || '').trim();
                const content = String(data.content ?? '');
                if (!targetPath) {
                    vscode.window.showErrorMessage('กรุณาระบุชื่อไฟล์หรือ Path ก่อนบันทึก');
                    return;
                }
                const basePath = this.getEffectiveBasePath(data.targetPath);
                const { resolvedPath, error } = (0, tools_1.resolveSafePath)(basePath, targetPath);
                if (error) {
                    vscode.window.showErrorMessage(`ไม่สามารถบันทึกไฟล์ได้: ${error}`);
                    return;
                }
                try {
                    const parentDir = path.dirname(resolvedPath);
                    if (!fs.existsSync(parentDir)) {
                        fs.mkdirSync(parentDir, { recursive: true });
                    }
                    const isNew = !fs.existsSync(resolvedPath);
                    let originalContent = null;
                    if (!isNew) {
                        try {
                            originalContent = fs.readFileSync(resolvedPath, 'utf8');
                        }
                        catch {
                            // ignore
                        }
                    }
                    fs.writeFileSync(resolvedPath, content, 'utf8');
                    const relPath = path.relative(basePath, resolvedPath);
                    const changeInfo = {
                        path: relPath || path.basename(resolvedPath),
                        fullPath: resolvedPath,
                        originalContent,
                        newContent: content,
                        isNew,
                    };
                    this._modifiedFiles.set(changeInfo.path, changeInfo);
                    await webviewView.webview.postMessage({
                        type: 'fileChanged',
                        path: changeInfo.path,
                        isNew: changeInfo.isNew,
                    });
                    try {
                        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
                        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                    }
                    catch {
                        // ignore
                    }
                    vscode.window.showInformationMessage(`บันทึกโค้ดลงใน '${changeInfo.path}' สำเร็จแล้ว`);
                    await webviewView.webview.postMessage({
                        type: 'codeApplied',
                        blockId: data.blockId,
                        path: changeInfo.path,
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`บันทึกไฟล์ล้มเหลว: ${msg}`);
                }
                return;
            }
            if (data.type === 'runInTerminal') {
                const command = String(data.command || '').trim();
                if (!command)
                    return;
                try {
                    let terminal = vscode.window.terminals.find(t => t.name === 'AiPASS Terminal');
                    if (!terminal) {
                        const targetPath = this.getEffectiveBasePath(data.targetPath);
                        terminal = vscode.window.createTerminal({ name: 'AiPASS Terminal', cwd: targetPath });
                    }
                    terminal.show(true);
                    terminal.sendText(command);
                    vscode.window.showInformationMessage(`ส่งคำสั่ง '${command}' ไปยัง Terminal แล้ว`);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`ไม่สามารถเปิด Terminal ได้: ${msg}`);
                }
                return;
            }
            if (data.type === 'deleteFile') {
                const filePath = String(data.path || '').trim();
                if (!filePath)
                    return;
                const basePath = this.getEffectiveBasePath(data.targetPath);
                const { resolvedPath, error } = (0, tools_1.resolveSafePath)(basePath, filePath);
                if (error) {
                    vscode.window.showErrorMessage(`ไม่สามารถลบไฟล์ได้: ${error}`);
                    return;
                }
                if (!fs.existsSync(resolvedPath)) {
                    vscode.window.showWarningMessage(`ไฟล์ '${filePath}' ไม่มีอยู่แล้ว`);
                    return;
                }
                try {
                    const originalContent = fs.readFileSync(resolvedPath, 'utf8');
                    fs.unlinkSync(resolvedPath);
                    const relPath = path.relative(basePath, resolvedPath);
                    const changeInfo = {
                        path: relPath || path.basename(resolvedPath),
                        fullPath: resolvedPath,
                        originalContent,
                        newContent: '',
                        isNew: false,
                        isDeleted: true,
                    };
                    this._modifiedFiles.set(changeInfo.path, changeInfo);
                    await webviewView.webview.postMessage({
                        type: 'fileChanged',
                        path: changeInfo.path,
                        isNew: false,
                        isDeleted: true,
                    });
                    vscode.window.showInformationMessage(`ลบไฟล์ '${changeInfo.path}' สำเร็จแล้ว`);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`ลบไฟล์ล้มเหลว: ${msg}`);
                }
                return;
            }
            if (data.type === 'newChat') {
                try {
                    await this._getClient().resetConversation();
                    this._modifiedFiles.clear();
                    await webviewView.webview.postMessage({ type: 'clearChat' });
                    vscode.window.showInformationMessage('เริ่มการสนทนาใหม่แล้ว (ล้างประวัติการสนทนาบน Bridge เรียบร้อย)');
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`ไม่สามารถเริ่มการสนทนาใหม่ได้: ${msg}`);
                }
                return;
            }
            if (data.type === 'sendMessage' || data.command === 'sendMessage') {
                const rawPrompt = data.value ?? data.text;
                if (!rawPrompt?.trim())
                    return;
                let prompt = rawPrompt.trim();
                if (prompt.startsWith('/explain')) {
                    prompt = `[คำสั่ง: อธิบายการทำงานของโค้ดอย่างละเอียด]\n${prompt.slice(8).trim() || 'อธิบายโค้ดใน active file'}`;
                }
                else if (prompt.startsWith('/fix')) {
                    prompt = `[คำสั่ง: ตรวจสอบและแก้ไขข้อผิดพลาดในโค้ดหรือ diagnostics]\n${prompt.slice(4).trim() || 'แก้ไขปัญหาใน active file'}`;
                }
                else if (prompt.startsWith('/test')) {
                    const rest = prompt.slice(5).trim();
                    prompt = `[คำสั่ง: สร้างและรัน Unit Test]\n${rest || 'เขียน Unit Test ที่ครอบคลุมสำหรับ active file พร้อมสร้าง/บันทึกไฟล์ test และใช้ run_terminal_command เพื่อรันเทสให้ผ่านทั้งหมด'}`;
                }
                else if (prompt.startsWith('/review')) {
                    prompt = `[คำสั่ง: Review โค้ดนี้ในแง่ Security, Performance และ Best Practices]\n${prompt.slice(7).trim() || 'review โค้ดใน active file'}`;
                }
                const mode = data.mode || 'agent';
                const targetPath = this.getEffectiveBasePath(data.targetPath);
                if (data.targetPath && this._workspaceState) {
                    void this._workspaceState.update('aipass.targetPath', String(data.targetPath).trim());
                }
                this._currentAbortController = new AbortController();
                try {
                    const context = this._getContext();
                    this._onContextUsed?.({ model: data.model, sections: context.sections });
                    let response = '';
                    if (mode === 'agent') {
                        response = await (0, bridge_1.fetchAgentResponse)(this._getClient(), prompt, data.model, targetPath, context.text, (progressMsg) => {
                            webviewView.webview.postMessage({
                                type: 'agentProgress',
                                message: progressMsg,
                                text: progressMsg,
                            });
                        }, (toolName, params, _result) => {
                            webviewView.webview.postMessage({
                                type: 'toolCall',
                                toolName,
                                params,
                            });
                        }, this._currentAbortController.signal, getWorkspaceDiagnostics, async (change) => {
                            this._modifiedFiles.set(change.path, change);
                            await webviewView.webview.postMessage({
                                type: 'fileChanged',
                                path: change.path,
                                isNew: change.isNew,
                                isDeleted: Boolean(change.isDeleted),
                            });
                            if (!change.isDeleted) {
                                try {
                                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(change.fullPath));
                                    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                                }
                                catch {
                                    // ignore editor opening error
                                }
                            }
                        });
                    }
                    else {
                        response = await (0, bridge_1.fetchAiResponse)(this._getClient(), prompt, data.model, context.text);
                    }
                    webviewView.webview.postMessage({
                        command: 'receiveMessage',
                        text: response,
                        type: 'addResponse',
                        value: response,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : 'ไม่สามารถรับคำตอบได้';
                    webviewView.webview.postMessage({
                        command: 'receiveMessage',
                        text: `เกิดข้อผิดพลาด: ${message}`,
                        type: 'addResponse',
                        value: `เกิดข้อผิดพลาด: ${message}`,
                        error: true,
                    });
                }
                finally {
                    this._currentAbortController = undefined;
                }
            }
        });
    }
    _getHtmlContent(chatCss, scriptUri) {
        const cachedModels = this.getCachedModels();
        const firstModel = cachedModels[0];
        const firstModelName = firstModel?.name || firstModel?.id || 'เลือกโมเดล';
        const modelOptions = cachedModels.map((m, idx) => {
            const name = m.name || m.id;
            const provider = m.provider || m.owned_by;
            const display = name + (provider ? ` · ${provider}` : '');
            return `<option value="${m.id}" data-display-name="${escapeHtmlText(name)}" ${idx === 0 ? 'selected' : ''}>${escapeHtmlText(display)}</option>`;
        }).join('\n                ');
        return `
    <link rel="stylesheet" href="${chatCss}">

    <body>

        <header class="topbar">
            <div class="brand">AiPASS Chat <span class="version-badge">v${this._extensionVersion}</span></div>
        </header>

        <div class="workspace">
            <label class="sr-only" for="model-select">โมเดล</label>
            <div class="model-picker-row">
                <select id="model-select" class="model-select" aria-label="โมเดล">
                    ${modelOptions}
                </select>
                <button id="refresh-models-btn" class="model-reload-btn" type="button" title="รีเฟรชรายการโมเดลจาก Bridge (Refresh Models)">🔄</button>
            </div>
        </div>

        <div class="path-bar" title="ระบุ Path โฟลเดอร์โปรเจกต์ที่ต้องการให้ Agent เข้าถึง (บันทึกการตั้งค่าแยกตามโปรเจกต์ให้อัตโนมัติ)">
            <button id="browse-path-btn" class="path-browse-btn" type="button" title="คลิกเพื่อเลือกโฟลเดอร์สำหรับ Project Root (Browse Directory)" aria-label="Browse Directory">📁</button>
            <span class="path-label" id="path-label-btn" role="button" tabindex="0" title="คลิกเพื่อเลือกโฟลเดอร์สำหรับ Project Root">Root:</span>
            <input id="target-path" class="path-input" type="text" placeholder="/path/to/project" spellcheck="false" aria-label="Project root path" title="Root path ของโปรเจกต์ (ระบบจะบันทึกค่าไว้แยกแต่ละโปรเจกต์ให้อัตโนมัติ)" />
            <button id="reset-path-btn" class="path-reset-btn" type="button" title="รีโหลดใช้ Current Project Path (Reload Current Project Path)" aria-label="Reload Current Project Path">↺</button>
        </div>

        <div id="chat-history" role="log" aria-live="polite">
            <div class="empty">เริ่มสนทนาด้วยคำถามแรกของคุณ หรือสั่งให้ Agent ตรวจสอบและแก้ไขโค้ดในโปรเจกต์ได้เลย</div>
        </div>

        <div class="slash-toolbar" aria-label="Slash commands">
            <button class="slash-chip" type="button" data-cmd="/explain" title="อธิบายการทำงานของโค้ด">/explain</button>
            <button class="slash-chip" type="button" data-cmd="/fix" title="ตรวจสอบและแก้บั๊ก">/fix</button>
            <button class="slash-chip" type="button" data-cmd="/test" title="สร้างและรัน Unit Tests">🧪 /test</button>
            <button class="slash-chip" type="button" data-cmd="/review" title="Review โค้ดและ Best Practices">/review</button>
        </div>

        <div id="status" class="status" role="status"></div>
        <div class="composer">
            <textarea id="input" rows="2" placeholder="Ask anything, inspect code, or request file changes..." aria-label="ข้อความคำถาม"></textarea>
            <div class="composer-footer">
                <div class="mode-dropdown-wrap">
                    <select id="mode-select" class="mode-select mode-agent" aria-label="เลือกโหมดการทำงาน (Agent หรือ Chat)" title="โหมด Agent: สามารถตรวจสอบ ค้นหา สร้าง และแก้ไขไฟล์ในโปรเจกต์ได้">
                        <option value="agent" selected>⚡ Agent</option>
                        <option value="chat">💬 Chat</option>
                    </select>
                </div>
                <span id="model-name" class="model-name" role="button" tabindex="0" title="คลิกเพื่อเลือกโมเดล">${escapeHtmlText(firstModelName)} <span class="chevron">⌄</span></span>
                <span class="composer-hint">⌘↵ Active file</span>
                <button id="send-btn" class="send-button" type="button" aria-label="ส่งข้อความ">↵ <span>Enter</span></button>
            </div>
        </div>

        <script src="${scriptUri}"></script>
        <script>
            // Inline script retained for cached model data injection
            const vscode = acquireVsCodeApi();
            const modelSelect = document.getElementById('model-select');
            const modelName = document.getElementById('model-name');
            const targetPathInput = document.getElementById('target-path');

            let currentMode = 'agent';
            let isRunning = false;

            function setMode(newMode, shouldSave) {
                currentMode = newMode === 'chat' ? 'chat' : 'agent';
                if (modeSelect) {
                    modeSelect.value = currentMode;
                    if (currentMode === 'agent') {
                        modeSelect.className = 'mode-select mode-agent';
                        modeSelect.title = 'โหมด Agent: สามารถตรวจสอบ ค้นหา สร้าง และแก้ไขไฟล์ในโปรเจกต์ได้';
                        input.placeholder = 'Ask anything, inspect code, or request file changes...';
                    } else {
                        modeSelect.className = 'mode-select mode-chat';
                        modeSelect.title = 'โหมด Chat: สนทนาทั่วไป ถามตอบ ไม่อ่าน/เขียนไฟล์โปรเจกต์';
                        input.placeholder = 'Ask anything (Chat mode - no file changes)...';
                    }
                }
                if (shouldSave) {
                    vscode.postMessage({ type: 'saveMode', mode: currentMode });
                }
            }

            if (modeSelect) {
                modeSelect.addEventListener('change', () => {
                    setMode(modeSelect.value, true);
                });
            }

            function triggerBrowseFolder() {
                vscode.postMessage({ type: 'browseTargetPath', currentPath: targetPathInput.value });
            }

            if (browsePathBtn) {
                browsePathBtn.addEventListener('click', triggerBrowseFolder);
            }

            if (pathLabelBtn) {
                pathLabelBtn.addEventListener('click', triggerBrowseFolder);
                pathLabelBtn.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        triggerBrowseFolder();
                    }
                });
            }

            if (resetPathBtn) {
                resetPathBtn.addEventListener('click', () => {
                    resetPathBtn.classList.add('rotating');
                    status.textContent = '🔄 กำลังรีโหลด Root กลับเป็น Current Project Path...';
                    vscode.postMessage({ type: 'resetTargetPath' });
                    setTimeout(() => {
                        resetPathBtn.classList.remove('rotating');
                        if (status.textContent.indexOf('กำลังรีโหลด Root') !== -1) {
                            status.textContent = '';
                        }
                    }, 2000);
                });
            }

            if (targetPathInput) {
                targetPathInput.addEventListener('change', () => {
                    vscode.postMessage({ type: 'saveTargetPath', path: targetPathInput.value });
                });
                targetPathInput.addEventListener('blur', () => {
                    vscode.postMessage({ type: 'saveTargetPath', path: targetPathInput.value });
                });
                targetPathInput.addEventListener('keydown', (event) => {
                    const isEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13;
                    if (isEnter) {
                        event.preventDefault();
                        targetPathInput.blur();
                        input.focus();
                    }
                });
            }

            if (refreshModelsBtn) {
                refreshModelsBtn.addEventListener('click', () => {
                    refreshModelsBtn.classList.add('rotating');
                    status.textContent = '🔄 กำลังดึงรายการโมเดลล่าสุดจาก Bridge...';
                    vscode.postMessage({ type: 'refreshModels' });
                    setTimeout(() => refreshModelsBtn.classList.remove('rotating'), 2500);
                });
            }

            if (modelName) {
                modelName.addEventListener('click', () => {
                    modelSelect.focus();
                    if (typeof modelSelect.showPicker === 'function') {
                        try { modelSelect.showPicker(); } catch {}
                    }
                });
                modelName.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        modelSelect.focus();
                        if (typeof modelSelect.showPicker === 'function') {
                            try { modelSelect.showPicker(); } catch {}
                        }
                    }
                });
            }

            document.querySelectorAll('.slash-chip').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cmd = btn.getAttribute('data-cmd') + ' ';
                    if (!input.value.startsWith('/')) {
                        input.value = cmd + input.value;
                    }
                    input.focus();
                });
            });

            window.openDiff = function(filePath) {
                vscode.postMessage({ type: 'openDiff', path: filePath });
            };

            window.revertFile = function(filePath) {
                vscode.postMessage({ type: 'revertFile', path: filePath });
            };

            window.openFile = function(filePath) {
                vscode.postMessage({ type: 'openFile', path: filePath, targetPath: targetPathInput.value });
            };

            window.applyCodeBlock = function(blockId) {
                const card = document.getElementById(blockId);
                if (!card) return;
                const input = card.querySelector('.code-file-input');
                const pathVal = (input ? input.value : '').trim();
                if (!pathVal) {
                    alert('กรุณาระบุชื่อไฟล์หรือ Path ก่อนกด Apply');
                    if (input) input.focus();
                    return;
                }
                const rawEncoded = card.getAttribute('data-raw-code') || '';
                const code = decodeURIComponent(rawEncoded);
                const btn = card.querySelector('.apply-code-btn');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '⏳ กำลังเขียน...';
                }
                vscode.postMessage({
                    type: 'applyCodeToFile',
                    blockId: blockId,
                    path: pathVal,
                    content: code,
                    targetPath: targetPathInput.value
                });
            };

            window.copyCodeBlock = function(blockId) {
                const card = document.getElementById(blockId);
                if (!card) return;
                const rawEncoded = card.getAttribute('data-raw-code') || '';
                const code = decodeURIComponent(rawEncoded);
                navigator.clipboard.writeText(code).then(() => {
                    const btn = card.querySelector('.copy-code-btn');
                    if (btn) {
                        const orig = btn.textContent;
                        btn.textContent = '✅ Copied!';
                        setTimeout(() => { btn.textContent = orig; }, 1500);
                    }
                });
            };

            window.runInTerminal = function(blockIdOrCmd) {
                let cmd = blockIdOrCmd;
                const card = document.getElementById(blockIdOrCmd);
                if (card) {
                    const rawEncoded = card.getAttribute('data-raw-code') || '';
                    cmd = decodeURIComponent(rawEncoded).trim();
                }
                if (!cmd) return;
                vscode.postMessage({ type: 'runInTerminal', command: cmd, targetPath: targetPathInput.value });
            };

            function updateModelNameDisplay() {
                if (!modelName || !modelSelect) return;
                const opt = modelSelect.options[modelSelect.selectedIndex];
                const rawText = opt ? opt.textContent : 'เลือกโมเดล';
                const cleanText = rawText.replace(/ · ไม่รองรับใน Chat$/, '');
                const displayName = (opt && opt.getAttribute('data-display-name')) || cleanText;
                modelName.innerHTML = escapeHtml(displayName) + ' <span class="chevron">⌄</span>';
            }

            const renderModels = (models) => {
                const previous = modelSelect.value;
                modelSelect.replaceChildren();
                (models || []).forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    const kind = model.kind || 'chat';
                    const supported = kind === 'chat' && model.ready !== false && model.selectable !== false;
                    const provider = model.provider || model.owned_by;
                    const name = model.name || model.id;
                    option.textContent = name + (provider ? ' · ' + provider : '') + (supported ? '' : ' · ไม่รองรับใน Chat');
                    option.setAttribute('data-display-name', name);
                    option.disabled = !supported;
                    option.title = supported ? (model.description || '') : 'ต้องใช้ media/options ที่ยังไม่มีใน VS Code Webview';
                    modelSelect.appendChild(option);
                });
                if (!models || !models.length) {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = 'เชื่อมต่อ Bridge เพื่อโหลดโมเดล';
                    modelSelect.appendChild(option);
                } else if (models.some(model => model.id === previous && model.kind === 'chat' && model.ready !== false && model.selectable !== false)) {
                    modelSelect.value = previous;
                } else {
                    const firstSupported = models.find(model => model.kind === 'chat' && model.ready !== false && model.selectable !== false);
                    if (firstSupported) modelSelect.value = firstSupported.id;
                }
                updateModelNameDisplay();
            };

            modelSelect.addEventListener('change', updateModelNameDisplay);

            function setRunningState(running) {
                isRunning = running;
                if (running) {
                    sendButton.textContent = '⏹ Stop';
                    sendButton.className = 'stop-button';
                    sendButton.title = 'หยุดการทำงานของ Agent';
                    sendButton.disabled = false;
                } else {
                    sendButton.textContent = '↵ Enter';
                    sendButton.className = 'send-button';
                    sendButton.title = 'ส่งข้อความ';
                    sendButton.disabled = false;
                }
            }

            const send = () => {
                if (isRunning) {
                    vscode.postMessage({ type: 'cancelAgent' });
                    status.textContent = 'กำลังยกเลิกการทำงาน...';
                    setRunningState(false);
                    return;
                }

                const text = input.value.trim();
                if (!text) return;

                let model = modelSelect ? modelSelect.value : '';
                if (!model && modelSelect && modelSelect.options.length > 0) {
                    const firstValid = Array.from(modelSelect.options).find(opt => !opt.disabled && opt.value) || modelSelect.options[0];
                    if (firstValid && firstValid.value) {
                        modelSelect.value = firstValid.value;
                        model = firstValid.value;
                        updateModelNameDisplay();
                    }
                }
                if (!model) {
                    model = 'gemini-3.1-flash-lite';
                }

                const pathVal = targetPathInput ? targetPathInput.value.trim() : '';

                const empty = history.querySelector('.empty');
                if (empty) empty.remove();
                const userDiv = document.createElement('div');
                userDiv.className = 'message user-msg';
                userDiv.style.borderLeftColor = '#89d185';
                userDiv.style.opacity = '0.9';
                userDiv.textContent = 'You: ' + text;
                history.appendChild(userDiv);
                history.scrollTop = history.scrollHeight;

                vscode.postMessage({
                    type: 'sendMessage',
                    value: text,
                    model: model,
                    mode: currentMode,
                    targetPath: pathVal
                });

                input.value = '';
                input.style.height = 'auto';
                setRunningState(true);
                status.textContent = currentMode === 'agent' ? '⚡ Agent กำลังเริ่มทำงาน...' : 'กำลังรอคำตอบ...';
            };

            if (sendButton) {
                sendButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    send();
                });
            }

            input.addEventListener('keydown', (event) => {
                // If user is currently in IME composition, do not intercept Enter
                if (event.isComposing || event.keyCode === 229) {
                    return;
                }

                const isEnter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13;
                if (!isEnter) return;

                // Shift + Enter = Insert newline (standard multi-line textbox behavior)
                if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
                    return;
                }

                // Plain Enter, Cmd+Enter, or Ctrl+Enter = Submit / Send message (equal to clicking Enter button)
                event.preventDefault();
                send();
            });

            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(Math.max(input.scrollHeight, 60), 180) + 'px';
            });

            function escapeHtml(str) {
                return String(str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            }

            let blockCounter = 0;

            function renderMarkdown(text) {
                if (!text) return '';

                const codeBlocks = [];
                const placeholderPrefix = '___CODE_BLOCK_PLACEHOLDER_';
                const codeFenceRegex = new RegExp('\\x60\\x60\\x60([^\\r\\n]*)\\r?\\n([\\s\\S]*?)\\x60\\x60\\x60', 'g');

                const processedText = text.replace(codeFenceRegex, function(match, rawTag, rawCode) {
                    const id = 'code-card-' + (++blockCounter);
                    const tag = (rawTag || '').trim();
                    let lang = tag;
                    let detectedPath = '';

                    if (tag.includes(':')) {
                        const parts = tag.split(':');
                        lang = parts[0].trim();
                        detectedPath = parts.slice(1).join(':').trim();
                    } else if (tag.includes('/') || (tag.includes('.') && !tag.includes(' '))) {
                        detectedPath = tag;
                        lang = tag.split('.').pop() || '';
                    }

                    if (!detectedPath) {
                        const firstLine = (rawCode.split(/\r?\n/)[0] || '').trim();
                        const m = firstLine.match(/^(?:\/\/|#|<!--|\/\*)\s*(?:file(?:name)?|path|ไฟล์)?\s*[:：]?\s*['"\\x60]?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_\-]+)['"\\x60]?(?:\s*\*\/|-->)?$/i);
                        if (m) detectedPath = m[1].trim();
                    }

                    codeBlocks.push({
                        id: id,
                        lang: lang || 'code',
                        code: rawCode,
                        detectedPath: detectedPath || '',
                    });

                    return placeholderPrefix + (codeBlocks.length - 1) + '___';
                });

                let html = escapeHtml(processedText);

                // Headings
                html = html.replace(/^### (.*?)$/gm, '<h3 class="md-h3">$1</h3>');
                html = html.replace(/^## (.*?)$/gm, '<h2 class="md-h2">$1</h2>');
                html = html.replace(/^# (.*?)$/gm, '<h1 class="md-h1">$1</h1>');

                // Bold & inline code
                html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
                html = html.replace(new RegExp('\\x60([^\\x60]+)\\x60', 'g'), '<code class="inline-code">$1</code>');

                // Bullet lists
                html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<div class="md-list-item">• $1</div>');

                // Spacing
                html = html.replace(/\n\n/g, '<div class="md-gap"></div>');
                html = html.replace(/\n/g, '<br>');

                // Restore code cards
                html = html.replace(new RegExp(placeholderPrefix + '(\\d+)___', 'g'), function(m, idxStr) {
                    const block = codeBlocks[parseInt(idxStr, 10)];
                    if (!block) return '';
                    const escapedCode = escapeHtml(block.code);
                    const encodedCode = encodeURIComponent(block.code);
                    const isShell = /^(bash|sh|zsh|shell|terminal|cmd|powershell)$/i.test(block.lang);
                    const runBtn = isShell
                        ? '<button class="run-term-btn" type="button" onclick="runInTerminal(\'' + block.id + '\')" title="รันคำสั่งใน Terminal ของ VS Code ทันที">▶ Run</button>'
                        : '';

                    return '<div class="code-card" id="' + block.id + '" data-raw-code="' + encodedCode + '">' +
                        '<div class="code-card-header">' +
                            '<span class="code-lang-badge">' + escapeHtml(block.lang) + '</span>' +
                            '<input class="code-file-input" type="text" value="' + escapeHtml(block.detectedPath) + '" placeholder="ระบุ path เช่น src/file.js" title="Path ของไฟล์ที่ต้องการบันทึก (สามารถแก้ไขได้)" spellcheck="false" />' +
                            runBtn +
                            '<button class="apply-code-btn" type="button" onclick="applyCodeBlock(\'' + block.id + '\')" title="เขียนโค้ดลงในไฟล์นี้และเปิดใน VS Code ทันที">⚡ Apply to File</button>' +
                            '<button class="copy-code-btn" type="button" onclick="copyCodeBlock(\'' + block.id + '\')" title="คัดลอกโค้ด">📋 Copy</button>' +
                        '</div>' +
                        '<pre class="code-pre"><code>' + escapedCode + '</code></pre>' +
                    '</div>';
                });

                return html;
            }

            window.addEventListener('message', event => {
                if (event.data.type === 'triggerPrompt') {
                    if (event.data.text && input) {
                        input.value = event.data.text;
                        send();
                    }
                    return;
                }
                if (event.data.type === 'clearChat') {
                    history.innerHTML = '<div class="empty">เริ่มสนทนาด้วยคำถามแรกของคุณ หรือสั่งให้ Agent ตรวจสอบและแก้ไขโค้ดในโปรเจกต์ได้เลย</div>';
                    status.textContent = '';
                    setRunningState(false);
                    return;
                }
                if (event.data.type === 'setModels') {
                    renderModels(event.data.models || []);
                    if (refreshModelsBtn) refreshModelsBtn.classList.remove('rotating');
                    if (event.data.fromRefresh) {
                        status.textContent = '✅ อัปเดตรายการโมเดลเรียบร้อย (' + (event.data.models ? event.data.models.length : 0) + ' โมเดล)';
                        setTimeout(() => {
                            if (status.textContent.indexOf('อัปเดตรายการโมเดลเรียบร้อย') !== -1) {
                                status.textContent = '';
                            }
                        }, 3000);
                    }
                    return;
                }
                if (event.data.type === 'initData' || event.data.type === 'setTargetPath') {
                    const newPath = event.data.path || event.data.basePath;
                    if (newPath) {
                        targetPathInput.value = newPath;
                        if (event.data.type === 'setTargetPath') {
                            targetPathInput.classList.add('flash-updated');
                            setTimeout(() => targetPathInput.classList.remove('flash-updated'), 1200);
                        }
                    }
                    if (event.data.mode) {
                        setMode(event.data.mode, false);
                    }
                    if (resetPathBtn) {
                        resetPathBtn.classList.remove('rotating');
                    }
                    if (status.textContent.indexOf('กำลังรีโหลด Root') !== -1) {
                        status.textContent = '';
                    }
                    return;
                }
                if (event.data.type === 'modelsError') {
                    if (refreshModelsBtn) refreshModelsBtn.classList.remove('rotating');
                    if (event.data.fallbackModels && event.data.fallbackModels.length > 0) {
                        renderModels(event.data.fallbackModels);
                    }
                    status.textContent = '⚠️ ' + event.data.message + ' (ใช้โมเดลจากแคช)';
                    setRunningState(false);
                    return;
                }
                if (event.data.type === 'agentProgress') {
                    status.textContent = event.data.message;
                    return;
                }
                if (event.data.type === 'toolCall') {
                    const toolStep = document.createElement('div');
                    toolStep.className = 'tool-step';
                    const p = event.data.params || {};
                    const isWrite = event.data.toolName === 'write_file' || event.data.toolName === 'replace_in_file';
                    const isDelete = event.data.toolName === 'delete_file' || event.data.toolName === 'delete_directory';
                    const isTerminal = event.data.toolName === 'run_terminal_command';
                    const isDir = event.data.toolName === 'create_directory';
                    const icon = isWrite ? '✏️ ' : (isDelete ? '🗑️ ' : (isTerminal ? '💻 ' : (isDir ? '📁 ' : '🔧 ')));
                    const paramDesc = p.path ? p.path : (p.command ? '"' + p.command + '"' : (p.query ? '"' + p.query + '"' : ''));
                    toolStep.textContent = icon + event.data.toolName + (paramDesc ? ': ' + paramDesc : '');
                    history.appendChild(toolStep);
                    history.scrollTop = history.scrollHeight;
                    return;
                }
                if (event.data.type === 'fileChanged') {
                    const card = document.createElement('div');
                    card.className = 'file-change-card';
                    const cardKey = encodeURIComponent(event.data.path).replace(/%/g, '_');
                    card.id = 'change-' + cardKey;
                    const isNew = event.data.isNew;
                    const isDeleted = Boolean(event.data.isDeleted);
                    const p = escapeHtml(event.data.path);
                    const tag = isDeleted
                        ? '<span style="color:#f48771;">(ลบไฟล์)</span>'
                        : (isNew ? '<span style="color:#4ec9b0;">(สร้างใหม่)</span>' : '<span style="color:#ce9178;">(แก้ไข)</span>');
                    const openBtn = isDeleted ? '' : '<button class="diff-btn" type="button" onclick="openFile(\'' + p + '\')" title="เปิดไฟล์ใน Editor">📂 Open</button>';
                    const diffBtn = (isNew || isDeleted) ? '' : '<button class="diff-btn" type="button" onclick="openDiff(\'' + p + '\')" title="ดูความเปลี่ยนแปลง">🔍 Diff</button>';
                    card.innerHTML = '<div class="file-change-info">✏️ <strong>' + p + '</strong> ' + tag + '</div>' +
                        '<div class="file-change-actions">' +
                            openBtn +
                            diffBtn +
                            '<button class="revert-btn" type="button" onclick="revertFile(\'' + p + '\')" title="ย้อนคืนค่า">↩️ Revert</button>' +
                        '</div>';
                    history.appendChild(card);
                    history.scrollTop = history.scrollHeight;
                    return;
                }
                if (event.data.type === 'codeApplied') {
                    const card = document.getElementById(event.data.blockId);
                    if (card) {
                        const btn = card.querySelector('.apply-code-btn');
                        if (btn) {
                            btn.disabled = false;
                            btn.textContent = '✅ Applied!';
                            btn.classList.add('applied');
                            setTimeout(() => {
                                btn.textContent = '⚡ Apply to File';
                                btn.classList.remove('applied');
                            }, 3000);
                        }
                    }
                    return;
                }
                if (event.data.type === 'fileReverted') {
                    const cardKey = encodeURIComponent(event.data.path).replace(/%/g, '_');
                    const card = document.getElementById('change-' + cardKey);
                    if (card) {
                        card.style.opacity = '0.6';
                        const info = card.querySelector('.file-change-info');
                        if (info) info.innerHTML += ' <span style="color:#f48771;">(ย้อนคืนค่าแล้ว)</span>';
                        const actions = card.querySelector('.file-change-actions');
                        if (actions) actions.remove();
                    }
                    return;
                }
                if (event.data.command !== 'receiveMessage' && event.data.type !== 'addResponse') {
                    return;
                }

                const empty = history.querySelector('.empty');
                if (empty) empty.remove();
                const div = document.createElement('div');
                div.className = event.data.error ? 'message error' : 'message assistant-msg';
                if (event.data.error) {
                    div.textContent = event.data.text ?? event.data.value;
                } else {
                    div.innerHTML = renderMarkdown(event.data.text ?? event.data.value);
                }
                history.appendChild(div);
                history.scrollTop = history.scrollHeight;
                setRunningState(false);
                status.textContent = '';
                input.focus();
            });

            vscode.postMessage({ type: 'webviewReady' });
        </script>
    </body>`;
    }
}
exports.AipassViewProvider = AipassViewProvider;
AipassViewProvider.viewType = 'aipass.chatView';
