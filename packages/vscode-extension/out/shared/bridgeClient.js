"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BridgeClient = void 0;
function compactBridgeError(status, body) {
    let message = body.trim();
    try {
        const parsed = JSON.parse(message);
        message = parsed?.error?.message ?? parsed?.message ?? message;
    }
    catch { /* the bridge may return plain text */ }
    // Cloudflare sometimes returns a complete HTML challenge page. It is not
    // useful in a chat bubble and can be several kilobytes long.
    const ray = message.match(/cf-ray[=: ]+([A-Za-z0-9-]+)/i)?.[1];
    const cloudflare = /cloudflare|attention required/i.test(message);
    message = message.replace(/<[^>]*>/g, ' ').replace(/\\n/g, ' ')
        .replace(/\s+/g, ' ').trim();
    if (cloudflare && status === 502) {
        const suffix = ray ? ` (Cloudflare Ray ID: ${ray})` : '';
        return `AiPASS upstream ถูกปฏิเสธโดย Cloudflare (HTTP 403)${suffix} — เปิดแท็บ de.aipass.net/chat ใหม่หรือ reload หน้า แล้วลองอีกครั้ง`;
    }
    if (/timed out waiting for the extension/i.test(message)) {
        return 'Extension ใน Chrome ไม่ตอบสนอง (timed out waiting for the extension) — ให้ตรวจสอบว่ามีแท็บ de.aipass.net/chat เปิดอยู่ใน Chrome และคลิกป๊อปอัป Extension เพื่อตรวจดูว่า Connected หรือไม่';
    }
    if (/no extension connected/i.test(message)) {
        return 'ไม่พบการเชื่อมต่อจาก Chrome Extension — ให้เปิดแท็บ de.aipass.net/chat ในเบราว์เซอร์ Chrome';
    }
    return message.length > 600 ? `${message.slice(0, 597)}...` : message;
}
async function throwBridgeError(res) {
    throw new Error(`Bridge responded ${res.status}: ${compactBridgeError(res.status, await res.text())}`);
}
async function isTransientBridge502(res) {
    if (res.status !== 502 && res.status !== 504)
        return false;
    const body = await res.clone().text();
    return /cloudflare|cf-ray|attention required|timed out waiting for the extension|no extension connected|could not reach the/i.test(body);
}
class BridgeClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async listModels() {
        const res = await fetch(`${this.baseUrl}/v1/models`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            await throwBridgeError(res);
        }
        const json = (await res.json());
        return json.data ?? [];
    }
    async chatCompletion(req) {
        const init = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
        };
        let res = await fetch(`${this.baseUrl}/v1/chat/completions`, init);
        // The bridge/Chrome extension can recover a rejected Cloudflare session or
        // transient extension reconnection (tab reload, handshake takes 2-4s).
        // Retry up to 2 times with progressive backoff before giving up.
        const maxRetries = 2;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (await isTransientBridge502(res)) {
                const delay = 2500 * (attempt + 1);
                await new Promise(resolve => setTimeout(resolve, delay));
                res = await fetch(`${this.baseUrl}/v1/chat/completions`, init);
            }
            else {
                break;
            }
        }
        if (!res.ok) {
            await throwBridgeError(res);
        }
        return res.json();
    }
    async resetConversation() {
        try {
            await fetch(`${this.baseUrl}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation: null }),
            });
        }
        catch {
            // ignore network errors when resetting conversation
        }
    }
    async createNewConversation(options) {
        try {
            const res = await fetch(`${this.baseUrl}/conversations/new`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: options?.model,
                    message: options?.message || 'New session',
                    temporary: options?.temporary ?? true,
                    assistant: options?.assistant,
                }),
            });
            if (res.ok) {
                return (await res.json());
            }
        }
        catch {
            // ignore
        }
        await this.resetConversation();
        return {};
    }
}
exports.BridgeClient = BridgeClient;
