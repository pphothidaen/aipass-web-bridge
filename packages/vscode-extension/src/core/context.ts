import * as vscode from 'vscode';
import {
    DEFAULT_CONTEXT_POLICY,
    ContextPolicy,
    ProjectContext,
    filterProjectContext,
    formatProjectContext,
} from '@aipass/shared';

const MAX_CONTENT = 12000;

function policyFromSettings(): ContextPolicy {
    const config = vscode.workspace.getConfiguration('aipass.context');
    return {
        identity: config.get<boolean>('identity', DEFAULT_CONTEXT_POLICY.identity),
        coding: config.get<boolean>('coding', DEFAULT_CONTEXT_POLICY.coding),
        projects: config.get<boolean>('projects', DEFAULT_CONTEXT_POLICY.projects),
        memory: config.get<boolean>('memory', DEFAULT_CONTEXT_POLICY.memory),
    };
}

export function getProjectContext(): { text: string; sections: string[] } {
    const editor = vscode.window.activeTextEditor;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const policy = policyFromSettings();
    const context: ProjectContext = {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        consumer: 'vscode',
        sections: [],
    };

    if (policy.identity) {
        const identity = vscode.workspace.getConfiguration('aipass').get<{ displayName?: string; role?: string }>('identity');
        if (identity && (identity.displayName || identity.role)) context.identity = identity;
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

    const filtered = filterProjectContext(context, policy);
    return { text: formatProjectContext(filtered), sections: filtered.sections };
}

export function getAgentBasePath(): string {
    const config = vscode.workspace.getConfiguration('aipass');
    const customPath = config.get<string>('agent.basePath', '').trim();
    if (customPath) {
        return customPath;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return process.cwd();
}