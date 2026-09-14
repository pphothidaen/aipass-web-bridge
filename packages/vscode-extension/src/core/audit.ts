import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';

export interface ContextAccessEvent {
    timestamp: string;
    consumer: 'vscode';
    model?: string;
    sections: string[];
    conversation: 'bridge';
}

export async function recordContextAccess(
    context: vscode.ExtensionContext,
    event: Omit<ContextAccessEvent, 'timestamp' | 'consumer' | 'conversation'>,
): Promise<void> {
    const file = join(context.globalStorageUri.fsPath, 'audit.jsonl');
    const record: ContextAccessEvent = {
        timestamp: new Date().toISOString(),
        consumer: 'vscode',
        conversation: 'bridge',
        ...event,
    };
    try {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
        // Auditing must never make a chat request fail.
    }
}