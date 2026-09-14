// src/core/bridge.ts
import { BridgeClient, ChatMessage } from '@aipass/shared';
import { runAgentLoop, AgentOptions } from './agent';
import { FileChangeInfo } from './tools';

export async function fetchAiResponse(
    client: BridgeClient,
    prompt: string,
    model: string | undefined,
    context?: string
): Promise<string> {
    const messages: ChatMessage[] = [];
    if (context?.trim()) {
        messages.push({
            role: 'user',
            content: `${context}\n\nคำถามจาก VS Code:\n${prompt}`,
        });
    } else {
        messages.push({ role: 'user', content: prompt });
    }

    const response = await client.chatCompletion({
        model: model || undefined,
        messages,
    });
    return response.choices?.[0]?.message?.content?.trim() || '(ไม่มีคำตอบจาก Bridge)';
}

export async function fetchAgentResponse(
    client: BridgeClient,
    prompt: string,
    model: string | undefined,
    baseDir: string,
    context?: string,
    onProgress?: (message: string) => void,
    onToolCall?: (toolName: string, params: Record<string, unknown>, result: string) => void,
    abortSignal?: AbortSignal,
    getDiagnostics?: (filePath?: string) => Promise<string> | string,
    onFileChange?: (change: FileChangeInfo) => void
): Promise<string> {
    return runAgentLoop(
        prompt,
        {
            client,
            model,
            baseDir,
            abortSignal,
            getDiagnostics,
            onFileChange,
            onProgress,
            onToolCall,
        },
        context
    );
}

