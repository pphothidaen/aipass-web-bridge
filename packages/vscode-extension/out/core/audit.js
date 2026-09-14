"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordContextAccess = recordContextAccess;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
async function recordContextAccess(context, event) {
    const file = (0, node_path_1.join)(context.globalStorageUri.fsPath, 'audit.jsonl');
    const record = {
        timestamp: new Date().toISOString(),
        consumer: 'vscode',
        conversation: 'bridge',
        ...event,
    };
    try {
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(file), { recursive: true });
        await (0, promises_1.appendFile)(file, `${JSON.stringify(record)}\n`, 'utf8');
    }
    catch {
        // Auditing must never make a chat request fail.
    }
}
