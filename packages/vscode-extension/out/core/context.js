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
exports.getProjectContext = getProjectContext;
exports.getAgentBasePath = getAgentBasePath;
const vscode = __importStar(require("vscode"));
const shared_1 = require("../shared");
const MAX_CONTENT = 12000;
function policyFromSettings() {
    const config = vscode.workspace.getConfiguration('aipass.context');
    return {
        identity: config.get('identity', shared_1.DEFAULT_CONTEXT_POLICY.identity),
        coding: config.get('coding', shared_1.DEFAULT_CONTEXT_POLICY.coding),
        projects: config.get('projects', shared_1.DEFAULT_CONTEXT_POLICY.projects),
        memory: config.get('memory', shared_1.DEFAULT_CONTEXT_POLICY.memory),
    };
}
function getProjectContext() {
    const editor = vscode.window.activeTextEditor;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const policy = policyFromSettings();
    const context = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        consumer: 'vscode',
        sections: [],
    };
    if (policy.identity) {
        const identity = vscode.workspace.getConfiguration('aipass').get('identity');
        if (identity && (identity.displayName || identity.role))
            context.identity = identity;
    }
    if (editor && policy.coding) {
        const selection = editor.document.getText(editor.selection);
        context.coding = {
            language: editor.document.languageId,
            activeFile: vscode.workspace.asRelativePath(editor.document.uri, false),
            ...(selection ? { selection: selection.slice(0, MAX_CONTENT) } : {}),
            content: (selection || editor.document.getText()).slice(0, MAX_CONTENT),
        };
    }
    if (policy.projects && folders.length) {
        context.projects = folders.map((folder) => ({
            name: folder.name,
            root: folder.uri.fsPath,
            languages: editor && folder.uri.scheme === editor.document.uri.scheme && editor.document.languageId
                ? [editor.document.languageId]
                : [],
        }));
    }
    const filtered = (0, shared_1.filterProjectContext)(context, policy);
    return { text: (0, shared_1.formatProjectContext)(filtered), sections: filtered.sections };
}
function getAgentBasePath() {
    const config = vscode.workspace.getConfiguration('aipass');
    const customPath = config.get('agent.basePath', '').trim();
    if (customPath) {
        return customPath;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return process.cwd();
}
