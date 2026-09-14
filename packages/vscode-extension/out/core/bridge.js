"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAiResponse = fetchAiResponse;
exports.fetchAgentResponse = fetchAgentResponse;
const agent_1 = require("./agent");
async function fetchAiResponse(client, prompt, model, context) {
    const messages = [];
    if (context?.trim()) {
        messages.push({
            role: 'user',
            content: `${context}\n\nคำถามจาก VS Code:\n${prompt}`,
        });
    }
    else {
        messages.push({ role: 'user', content: prompt });
    }
    const response = await client.chatCompletion({
        model: model || undefined,
        messages,
    });
    return response.choices?.[0]?.message?.content?.trim() || '(ไม่มีคำตอบจาก Bridge)';
}
async function fetchAgentResponse(client, prompt, model, baseDir, context, onProgress, onToolCall, abortSignal, getDiagnostics, onFileChange) {
    return (0, agent_1.runAgentLoop)(prompt, {
        client,
        model,
        baseDir,
        abortSignal,
        getDiagnostics,
        onFileChange,
        onProgress,
        onToolCall,
    }, context);
}
