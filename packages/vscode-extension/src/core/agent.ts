// src/core/agent.ts
import * as path from 'node:path';
import { BridgeClient, ChatMessage } from '@aipass/shared';
import { AGENT_TOOLS, executeTool, FileChangeInfo } from './tools';

export interface AgentOptions {
  client: BridgeClient;
  model?: string;
  baseDir: string;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  getDiagnostics?: (filePath?: string) => Promise<string> | string;
  onFileChange?: (change: FileChangeInfo) => void;
  onProgress?: (message: string) => void;
  onToolCall?: (toolName: string, params: Record<string, unknown>, result: string) => void;
}

export interface ParsedToolCall {
  name: string;
  parameters: Record<string, unknown>;
  raw: string;
}

export interface ExtractedCodeBlock {
  path?: string;
  language: string;
  code: string;
  raw: string;
}

const COMMON_CODE_EXTS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'json', 'html', 'css', 'scss', 'less',
  'py', 'pyw', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
  'go', 'rs', 'php', 'rb', 'sh', 'bash', 'zsh',
  'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql',
  'md', 'txt', 'env',
]);

export function extractCodeBlocksWithPaths(content: string): ExtractedCodeBlock[] {
  const results: ExtractedCodeBlock[] = [];
  const regex = /```([^\r\n]*)\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const rawTag = (match[1] || '').trim();
    const rawCode = match[2] || '';
    const rawBlock = match[0];
    const startIndex = match.index;

    let detectedPath: string | undefined;
    let language = rawTag;

    // Check if lang tag has path (e.g. javascript:path/to/file.js or path/to/file.js)
    if (rawTag.includes(':')) {
      const parts = rawTag.split(':');
      language = parts[0].trim();
      detectedPath = parts.slice(1).join(':').trim();
    } else if (rawTag.includes('/') || (rawTag.includes('.') && !rawTag.includes(' '))) {
      detectedPath = rawTag;
      language = path.extname(rawTag).replace('.', '');
    }

    const codeLines = rawCode.split(/\r?\n/);
    // If no path from lang tag, inspect first line of code block
    if (!detectedPath && codeLines.length > 0) {
      const firstLine = codeLines[0].trim();
      const commentMatch = firstLine.match(/^(?:\/\/|#|<!--|\/\*)\s*(?:file(?:name)?|path|ไฟล์)?\s*[:：]?\s*[`"']?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_\-]+)[`"']?(?:\s*\*\/|-->)?$/i);
      if (commentMatch) {
        const cand = commentMatch[1].trim();
        const ext = path.extname(cand).toLowerCase().replace('.', '');
        if (COMMON_CODE_EXTS.has(ext) || ext.length <= 5) {
          detectedPath = cand;
        }
      }
    }

    // If still no path, inspect preceding text (up to 4 lines before the code block)
    if (!detectedPath && startIndex > 0) {
      const precedingText = content.slice(Math.max(0, startIndex - 300), startIndex);
      const lines = precedingText.trim().split(/\r?\n/);
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
        const line = lines[i].trim();
        const headerMatch = line.match(/(?:###|##|#|\*\*|\*|สร้างไฟล์|แก้ไขไฟล์|ไฟล์|File|Path)\s*(?:\d+[\.\)]\s*)?[:：]?\s*[`"']?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_\-]+)[`"']?/i)
          || line.match(/[`"']([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9_\-]+)[`"']/);
        if (headerMatch) {
          const cand = headerMatch[1].trim();
          if (!cand.startsWith('http') && !cand.includes('//')) {
            const ext = path.extname(cand).toLowerCase().replace('.', '');
            if (COMMON_CODE_EXTS.has(ext) || ext.length <= 5) {
              detectedPath = cand;
              break;
            }
          }
        }
      }
    }

    results.push({
      path: detectedPath,
      language: language.toLowerCase(),
      code: rawCode,
      raw: rawBlock,
    });
  }

  return results;
}

export function isToolRefusalReply(reply: string): boolean {
  if (typeof reply !== 'string') return false;
  const normalized = reply.toLowerCase();
  const refusalPatterns = [
    /ไม่มีเครื่องมือ/i,
    /ไม่สามารถเข้าถึงระบบไฟล์/i,
    /ไม่สามารถเข้าถึงไฟล์/i,
    /ค้นหาเว็บเท่านั้น/i,
    /มีเพียงการค้นหาเว็บ/i,
    /ไม่มีสิทธิ์เข้าถึง/i,
    /เชื่อมต่อกับเครื่องมือ.*ไม่ได้/i,
    /สภาพแวดล้อมนี้.*ไม่สามารถ/i,
    /ไม่สามารถสร้างหรืออ่านไฟล์.*ได้ในตอนนี้/i,
    /ระบบตอนนี้เชื่อมต่อกับเครื่องมือ/i,
    /เครื่องมือ.*สำหรับ.*(อ่าน|ค้นหา).*เท่านั้น/i,
    /ไม่มีเครื่องมือ.*เขียนไฟล์/i,
    /ไม่สามารถสร้างไฟล์ให้อัตโนมัติ/i,
    /cannot access (the |your )?(local )?(file|project|computer|directory|disk|workspace)/i,
    /do not have access to (the |your )?(local )?(file|project|computer|directory|disk|workspace)/i,
    /don't have access to (the |your )?(local )?(file|project|computer|directory|disk|workspace)/i,
    /no direct access to (the |your )?(local )?(file|project|computer|directory|disk|workspace)/i,
    /only tool I have is web(_|\s*)search/i,
    /only have (access to )?web(_|\s*)search/i,
    /lack tools? to (read|inspect|access)/i,
    /i cannot (view|read|open|edit) (your )?files/i,
    /i do not have (a |the )?(tool|capability) to (read|access|view|edit|write|create)/i,
    /don't have (a |the )?(tool|capability) to (read|access|view|edit|write|create)/i,
    /unable to access (your|the) (local )?(files|project|directory|filesystem)/i,
    /cannot connect to (the )?(local )?tools/i,
    /not able to create or (read|edit) files? in this environment/i,
  ];
  return refusalPatterns.some((pattern) => pattern.test(normalized));
}

export function buildAgentSystemPrompt(baseDir: string, initialListing?: string): string {
  const toolDescriptions = AGENT_TOOLS.map((tool) => {
    const paramsStr = tool.parameters
      .map((p) => `    - ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`)
      .join('\n');
    return `- ${tool.name}: ${tool.description}\n  Parameters:\n${paramsStr}`;
  }).join('\n\n');

  const listingBlock = initialListing?.trim()
    ? `\nTop-level project files and folders right now:\n\`\`\`\n${initialListing.trim()}\n\`\`\`\n`
    : '';

  return `I am reading through a project with you in VS Code.
The user has this project open in VS Code on their local computer at "${baseDir}".
${listingBlock}
The files are open in front of me, and your VS Code extension acts as your hands: it executes every tool request directly on the user's filesystem and returns the output to you.
The markers are only formatting for my editor. Nothing runs on your side — I do all of it and paste every result straight back to you, so keep going until you have what you need.
Never claim that you lack tools, never say you cannot access local files or the filesystem, never claim that you only have read or search tools, and never state that your only tool is web search. You have full permission and capabilities to create, write, edit, and inspect files via write_file and CREATE markers.

So just tell me what you want to see or do next, and put that on its own line in this shape, because my editor watches for these markers:

NEED dir .
NEED file README.md
SEARCH text to find across the whole project

If you want a file changed, write it like this and I will make the edit:

EDIT notes.md
FIND
the exact lines as they appear now
NEW
the lines to put there instead
END

To start a new file or write to a file:

CREATE notes.md
the contents
END

To append to an existing file:

APPEND notes.md
the contents to append
END

To delete a file:

DELETE file notes.md

To create a directory / folder:

MKDIR src/utils

To delete a directory / folder:

DELETE dir temp_folder

To run a command in the terminal:

RUN npm test
(or RUN on one line followed by commands and END)

You can also invoke tools using standard XML tag:
<tool_call>
{"name": "tool_name", "parameters": { ... }}
</tool_call>

Once you have everything you need and are giving me your final answer, finish with:

DONE one sentence about what you found or changed

A few practical notes:
- Always answer in the same language as my question (e.g. Thai if asked in Thai).
- Look at a file before changing it, and copy the lines under FIND exactly as they appear.
- When modifying or creating code, write complete, working code.
- If my question can be answered without changing anything, just answer it and end with DONE.

AVAILABLE TOOLS REFERENCE:
${toolDescriptions}`;
}

export function parseAllToolCalls(content: string): { calls: ParsedToolCall[]; done?: string } {
  if (typeof content !== 'string') return { calls: [] };

  const calls: ParsedToolCall[] = [];
  let doneSummary: string | undefined;

  // 1. Check for <tool_call>...</tool_call>
  const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let xmlMatch: RegExpExecArray | null;
  while ((xmlMatch = xmlRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(xmlMatch[1].trim());
      if (parsed && typeof parsed.name === 'string') {
        calls.push({
          name: parsed.name,
          parameters: parsed.parameters || parsed.params || parsed.arguments || {},
          raw: xmlMatch[0],
        });
      }
    } catch {
      // ignore
    }
  }

  // 2. Check for <function=tool_name>...</function> or <tool_call:tool_name>...</tool_call:tool_name>
  const funcRegex = /<(?:function|tool_call)[:=]([a-zA-Z0-9_-]+)>([\s\S]*?)<\/(?:function|tool_call)(?::\1)?>/gi;
  let funcTagMatch: RegExpExecArray | null;
  while ((funcTagMatch = funcRegex.exec(content)) !== null) {
    try {
      const toolName = funcTagMatch[1].trim();
      const rawParams = funcTagMatch[2].trim();
      const parsedParams = rawParams ? JSON.parse(rawParams) : {};
      calls.push({
        name: toolName,
        parameters: parsedParams,
        raw: funcTagMatch[0],
      });
    } catch {
      // ignore
    }
  }

  // 3. Scan line-by-line for action markers (NEED, EDIT, CREATE, RUN, SEARCH, TREE, DONE)
  const lines = content.split(/\r?\n/);
  let i = 0;
  const readUntil = (stops: string[]) => {
    const body: string[] = [];
    while (i < lines.length && !stops.some((st) => new RegExp(`^\\s*${st}\\s*$`, 'i').test(lines[i]))) {
      body.push(lines[i++]);
    }
    return body.join('\n');
  };

  while (i < lines.length) {
    const line = lines[i];

    // NEED file <path> [start-end]
    const needFileM = /^\s*NEED\s+file\s+(\S+)(?:\s+(\d+)(?:-(\d+))?)?\s*$/i.exec(line);
    if (needFileM) {
      i++;
      const filePath = needFileM[1].trim();
      const startLine = needFileM[2] ? parseInt(needFileM[2], 10) : undefined;
      const endLine = needFileM[3] ? parseInt(needFileM[3], 10) : (startLine ? startLine + 250 : undefined);
      calls.push({
        name: 'read_file',
        parameters: {
          path: filePath,
          ...(startLine ? { start_line: startLine } : {}),
          ...(endLine ? { end_line: endLine } : {}),
        },
        raw: needFileM[0],
      });
      continue;
    }

    // NEED dir <path>
    const needDirM = /^\s*NEED\s+dir\s+(.+?)\s*$/i.exec(line);
    if (needDirM) {
      i++;
      const dirPath = needDirM[1].trim();
      calls.push({
        name: 'list_dir',
        parameters: { path: dirPath === '.' ? '' : dirPath },
        raw: needDirM[0],
      });
      continue;
    }

    // SEARCH <query>
    const searchM = /^\s*SEARCH\s+(.+?)\s*$/i.exec(line);
    if (searchM) {
      i++;
      calls.push({
        name: 'grep_search',
        parameters: { query: searchM[1].trim() },
        raw: searchM[0],
      });
      continue;
    }

    // TREE [path]
    const treeM = /^\s*TREE(?:\s+(.+?))?\s*$/i.exec(line);
    if (treeM && treeM[0].trim().toUpperCase().startsWith('TREE')) {
      i++;
      calls.push({
        name: 'get_file_tree',
        parameters: { path: (treeM[1] || '.').trim() },
        raw: treeM[0],
      });
      continue;
    }

    // EDIT <path> \n FIND \n ... \n NEW \n ... \n END
    const editM = /^\s*EDIT\s+(\S+)\s*$/i.exec(line);
    if (editM) {
      i++;
      if (/^\s*FIND\s*$/i.test(lines[i] ?? '')) i++;
      const before = readUntil(['NEW', 'END']);
      if (/^\s*NEW\s*$/i.test(lines[i] ?? '')) i++;
      const after = readUntil(['END']);
      if (/^\s*END\s*$/i.test(lines[i] ?? '')) i++;
      calls.push({
        name: 'replace_in_file',
        parameters: {
          path: editM[1].trim(),
          target_content: before,
          replacement_content: after,
        },
        raw: editM[0],
      });
      continue;
    }

    // CREATE or WRITE <path> \n ... \n END
    const createM = /^\s*(?:CREATE|WRITE)\s+(\S+)\s*$/i.exec(line);
    if (createM) {
      i++;
      const body = readUntil(['END']);
      if (/^\s*END\s*$/i.test(lines[i] ?? '')) i++;
      calls.push({
        name: 'write_file',
        parameters: {
          path: createM[1].trim(),
          content: body,
        },
        raw: createM[0],
      });
      continue;
    }

    // APPEND <path> \n ... \n END
    const appendM = /^\s*APPEND\s+(\S+)\s*$/i.exec(line);
    if (appendM) {
      i++;
      const body = readUntil(['END']);
      if (/^\s*END\s*$/i.test(lines[i] ?? '')) i++;
      calls.push({
        name: 'append_to_file',
        parameters: {
          path: appendM[1].trim(),
          content: body,
        },
        raw: appendM[0],
      });
      continue;
    }

    // DELETE file <path>
    const deleteFileM = /^\s*DELETE\s+file\s+(\S+)\s*$/i.exec(line);
    if (deleteFileM) {
      i++;
      calls.push({
        name: 'delete_file',
        parameters: { path: deleteFileM[1].trim() },
        raw: deleteFileM[0],
      });
      continue;
    }

    // DELETE dir <path> or DELETE directory <path>
    const deleteDirM = /^\s*DELETE\s+dir(?:ectory)?\s+(\S+)\s*$/i.exec(line);
    if (deleteDirM) {
      i++;
      calls.push({
        name: 'delete_directory',
        parameters: { path: deleteDirM[1].trim() },
        raw: deleteDirM[0],
      });
      continue;
    }

    // MKDIR <path> or CREATE dir <path>
    const mkdirM = /^\s*(?:MKDIR|CREATE\s+dir(?:ectory)?)\s+(\S+)\s*$/i.exec(line);
    if (mkdirM) {
      i++;
      calls.push({
        name: 'create_directory',
        parameters: { path: mkdirM[1].trim() },
        raw: mkdirM[0],
      });
      continue;
    }

    // RUN <command> on one line, OR RUN \n ... \n END
    const singleLineRunM = /^\s*RUN\s+(.+)$/i.exec(line);
    if (singleLineRunM) {
      i++;
      calls.push({
        name: 'run_terminal_command',
        parameters: { command: singleLineRunM[1].trim() },
        raw: singleLineRunM[0],
      });
      continue;
    }

    // RUN \n ... \n END
    if (/^\s*RUN\s*$/i.test(line)) {
      i++;
      const body = readUntil(['END']);
      if (/^\s*END\s*$/i.test(lines[i] ?? '')) i++;
      calls.push({
        name: 'run_terminal_command',
        parameters: { command: body.trim() },
        raw: line,
      });
      continue;
    }

    // DONE [summary]
    const doneM = /^\s*DONE\b\s*(.*)$/i.exec(line);
    if (doneM) {
      i++;
      doneSummary = doneM[1].trim();
      continue;
    }

    i++;
  }

  // 4. Fallback: bare JSON
  if (calls.length === 0) {
    const bareJsonMatch = content.match(/\{\s*"name"\s*:\s*"([a-zA-Z0-9_-]+)"\s*,\s*"(?:parameters|params|arguments)"\s*:\s*(\{[\s\S]*?\})\s*\}/i);
    if (bareJsonMatch) {
      try {
        const parsed = JSON.parse(bareJsonMatch[0]);
        if (parsed && typeof parsed.name === 'string') {
          calls.push({
            name: parsed.name,
            parameters: parsed.parameters || parsed.params || parsed.arguments || {},
            raw: bareJsonMatch[0],
          });
        }
      } catch {
        // ignore
      }
    }
  }

  return { calls, done: doneSummary };
}

export function parseToolCall(content: string): ParsedToolCall | null {
  const { calls } = parseAllToolCalls(content);
  return calls.length > 0 ? calls[0] : null;
}

export async function runAgentLoop(
  userPrompt: string,
  options: AgentOptions,
  initialContextText?: string
): Promise<string> {
  const {
    client,
    model,
    baseDir,
    maxSteps = 8,
    onProgress,
    onToolCall,
  } = options;

  // Grounding: get top-level listing so model immediately sees real files
  let initialListing = '';
  try {
    const listRes = await executeTool(baseDir, 'list_dir', { path: '.' });
    if (listRes && !listRes.startsWith('Error:')) {
      initialListing = listRes;
    }
  } catch {
    // ignore
  }

  const systemPrompt = buildAgentSystemPrompt(baseDir, initialListing);

  const messages: ChatMessage[] = [];

  let firstUserMsg = '';
  if (initialContextText?.trim()) {
    firstUserMsg += `${initialContextText.trim()}\n\n`;
  }
  firstUserMsg += `${systemPrompt}\n\nTask:\n${userPrompt}\n\nProceed with the task now (using CREATE, EDIT, NEED, SEARCH, RUN, or tool calls as appropriate):`;

  messages.push({ role: 'user', content: firstUserMsg });

  let step = 0;
  let refusalCount = 0;
  while (step < maxSteps) {
    if (options.abortSignal?.aborted) {
      return '(Agent ถูกยกเลิกโดยผู้ใช้)';
    }

    step++;

    onProgress?.(`กำลังคิดและประมวลผล (รอบที่ ${step}/${maxSteps})...`);

    let completion;
    let completionAttempts = 0;
    while (completionAttempts < 2) {
      if (options.abortSignal?.aborted) {
        return '(Agent ถูกยกเลิกโดยผู้ใช้)';
      }
      try {
        completion = await client.chatCompletion({
          model: model || undefined,
          messages,
        });
        break;
      } catch (err) {
        completionAttempts++;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (completionAttempts < 2 && /cloudflare|502|upstream/i.test(errMsg)) {
          onProgress?.('⚠️ พบการแจ้งเตือนจาก Cloudflare กำลังรอเชื่อมต่อและลองใหม่อีกครั้ง...');
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        throw err;
      }
    }

    if (options.abortSignal?.aborted) {
      return '(Agent ถูกยกเลิกโดยผู้ใช้)';
    }

    if (!completion) {
      return '(ไม่สามารถรับคำตอบจากโมเดลได้)';
    }

    const assistantReply = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!assistantReply) {
      return '(ไม่มีคำตอบจากโมเดล)';
    }

    const parsed = parseAllToolCalls(assistantReply);
    const toolCalls = parsed.calls;

    if (toolCalls.length === 0) {
      // Check if the assistant produced code blocks with file paths that should be written to disk
      const extractedFiles = extractCodeBlocksWithPaths(assistantReply).filter((b) => b.path && b.code.trim());
      if (extractedFiles.length > 0) {
        let anyWritten = false;
        const savedPaths: string[] = [];
        for (const fileBlock of extractedFiles) {
          const filePath = fileBlock.path!;
          onProgress?.(`✏️ กำลังบันทึกไฟล์ [write_file] (path: ${filePath})...`);
          try {
            const toolResult = await executeTool(
              baseDir,
              'write_file',
              { path: filePath, content: fileBlock.code },
              {
                getDiagnostics: options.getDiagnostics,
                onFileChange: options.onFileChange,
              }
            );
            onToolCall?.('write_file', { path: filePath }, toolResult);
            anyWritten = true;
            savedPaths.push(filePath);
          } catch (err) {
            onToolCall?.(
              'write_file',
              { path: filePath },
              `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        if (anyWritten) {
          const confirmation = `\n\n---\n✅ **AiPASS บันทึกไฟล์ลงในโปรเจกต์ให้เรียบร้อยแล้ว:**\n${savedPaths.map((p) => `- \`${p}\``).join('\n')}`;
          return assistantReply + confirmation;
        }
      }

      // Check if the assistant refused due to false belief about file tools / access
      if (isToolRefusalReply(assistantReply) && step < maxSteps) {
        refusalCount++;
        onProgress?.('⚠️ ได้รับการแจ้งเตือนจากโมเดลเรื่องสิทธิ์ไฟล์ — กำลังเชื่อมต่อคำสั่งผ่าน VS Code Extension อัตโนมัติ...');

        // Clear poisoned bridge conversation cache so next request is clean
        try {
          await client.resetConversation();
        } catch {
          // ignore
        }

        messages.push({ role: 'assistant', content: assistantReply });
        messages.push({
          role: 'user',
          content: `คุณมีเครื่องมือสำหรับสร้างและแก้ไขไฟล์ในเครื่องโปรเจกต์ของผู้ใช้แล้ว (write_file, replace_in_file, create_directory) รวมถึงเครื่องมือรันคำสั่ง terminal (run_terminal_command)
VS Code Extension จะทำหน้าที่เป็นมือคอยรันและบันทึกไฟล์ให้คุณทันทีบนเครื่องของผู้ใช้ที่ "${baseDir}"

หากต้องการสร้างไฟล์ ให้ใช้รูปแบบนี้:
CREATE <path>
<เนื้อหาของไฟล์ทั้งหมด>
END

หรือเรียกใช้ tool ด้วย tag:
<tool_call>
{"name": "write_file", "parameters": {"path": "<path>", "content": "<เนื้อหา>"}}
</tool_call>

กรุณาสร้างหรือเขียนไฟล์ตามที่ได้รับมอบหมายทันที:`,
        });
        continue;
      }

      // No tool call and not a refusal: assistant provided the final answer!
      return assistantReply;
    }

    // Reset refusal count once a valid tool call is found
    refusalCount = 0;

    // Execute all tool calls in sequence
    const turnResults: string[] = [];
    for (const toolCall of toolCalls) {
      if (options.abortSignal?.aborted) {
        return '(Agent ถูกยกเลิกโดยผู้ใช้)';
      }

      const toolName = toolCall.name;
      const params = toolCall.parameters;
      const readableParam = params.path
        ? `path: ${params.path}`
        : params.command
          ? `cmd: "${String(params.command).slice(0, 50)}"`
          : params.query
            ? `query: "${params.query}"`
            : JSON.stringify(params);

      const actionIcon =
        toolName === 'write_file' || toolName === 'replace_in_file'
          ? '✏️'
          : toolName === 'delete_file' || toolName === 'delete_directory'
            ? '🗑️'
            : toolName === 'create_directory'
              ? '📁'
              : toolName === 'run_terminal_command'
                ? '💻'
                : '🔍';
      onProgress?.(`${actionIcon} กำลังเรียกใช้ [${toolName}] (${readableParam})...`);

      let toolResult = '';
      try {
        toolResult = await executeTool(baseDir, toolName, params, {
          getDiagnostics: options.getDiagnostics,
          onFileChange: options.onFileChange,
        });
      } catch (err) {
        toolResult = `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      onToolCall?.(toolName, params, toolResult);
      turnResults.push(`Result of ${toolName} (${readableParam}):\n${toolResult}`);
    }

    // Append assistant's message and user's tool results to conversation history
    messages.push({ role: 'assistant', content: assistantReply });
    messages.push({
      role: 'user',
      content: `${turnResults.join('\n\n')}\n\nWhat next? Ask for anything else you need, or finish with DONE if you have enough.`,
    });
  }

  // Reached max steps
  return `(จบการทำงานเนื่องจากเกินจำนวนขั้นตอนสูงสุด ${maxSteps} รอบ)\n\nข้อความล่าสุดจากโมเดล:\n${messages[messages.length - 2]?.content || ''}`;
}
