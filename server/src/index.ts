import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { runAgentLoop } from "./agent.js";
import type { LlmConfig } from "./llm.js";
import { chatComplete } from "./llm.js";
import type { ServerEvent } from "./events.js";
import {
  createSession,
  listSessions,
  deleteSession,
  getSessionMessages,
  saveMessage,
  getSessionTitle,
  updateSessionTitle,
} from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

// 默认 LLM 配置 — 可通过请求体覆盖
const defaultConfig: Partial<LlmConfig> = {
  model: "deepseek-v4-pro",
  systemPrompt: [
    "你是 SywayClaw，一个智能助手。你运行在用户的本地环境中，拥有以下工具：",
    "- read_file: 读取文件内容",
    "- read_lines: 按行范围读取文件（适合大文件）",
    "- write_file: 写入或覆盖文件",
    "- delete_file: 删除文件",
    "- create_directory: 创建目录",
    "- list_directory: 列出目录内容",
    "- search_files: 按 glob 模式搜索文件",
    "- grep_code: 在文件内容中搜索匹配行",
    "- get_file_info: 获取文件大小、修改时间等",
    "- run_command: 执行 Shell 命令",
    "- web_fetch: 抓取网页纯文本内容",
    "- web_search: 搜索网页信息（Bing）",
    "你可以使用这些工具来帮助用户完成任务。分析问题、制定计划、执行操作、验证结果。",
  ].join("\n"),
};

// ===================== 会话 API =====================

// 获取会话列表
app.get("/api/sessions", (_req, res) => {
  res.json(listSessions());
});

// 创建新会话
app.post("/api/sessions", (req, res) => {
  const { title } = req.body as { title?: string };
  const id = randomUUID();
  const session = createSession(id, title);
  res.json(session);
});

// 重命名会话
app.put("/api/sessions/:id", (req, res) => {
  const { title } = req.body as { title?: string };
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const ok = updateSessionTitle(req.params.id, title);
  res.json({ ok });
});

// 删除会话
app.delete("/api/sessions/:id", (req, res) => {
  const ok = deleteSession(req.params.id);
  res.json({ ok });
});

// 获取会话消息
app.get("/api/sessions/:id/messages", (req, res) => {
  const messages = getSessionMessages(req.params.id);
  res.json(messages);
});

// ===================== 聊天 API =====================

// POST /api/chat — 流式 Agent 响应 (SSE)
app.post("/api/chat", async (req, res) => {
  const { message, apiKey, model, systemPrompt, history, sessionId } = req.body as {
    message?: string;
    apiKey?: string;
    model?: string;
    systemPrompt?: string;
    history?: Array<{ role: string; content: string }>;
    sessionId?: string;
  };

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const apiKeyFinal = apiKey || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKeyFinal) {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }

  // 自动创建会话
  const sid = sessionId || randomUUID();
  if (!sessionId) {
    createSession(sid);
  }

  // 保存用户消息
  saveMessage(sid, "user", message);

  const config: LlmConfig = {
    apiKey: apiKeyFinal,
    model: model || defaultConfig.model || "deepseek-chat",
    systemPrompt: systemPrompt || defaultConfig.systemPrompt,
  };

  // 设置 SSE 响应头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");         // 禁用 nginx 缓冲
  res.flushHeaders();

  // 禁用 Nagle 算法，确保实时流式传输
  if (res.socket) res.socket.setNoDelay(true);

  // 收集工具调用事件（用于临时匹配 start/end）
  const toolCallList: Array<{ name: string; args: string; result?: string; error?: string }> = [];

  // 跟踪助手回复片段（文本 / 工具调用按时间序排列）
  type AssistantSegment =
    | { type: "text"; content: string }
    | { type: "tool"; name: string; args: string; result?: string; error?: string };
  const segments: AssistantSegment[] = [];
  let textBuffer = "";

  const emit = (event: ServerEvent) => {
    switch (event.type) {
      case "text_delta":
        textBuffer += event.text;
        break;

      case "tool_call_start":
        // 工具调用前先保存累积的文本片段
        if (textBuffer) {
          segments.push({ type: "text", content: textBuffer });
          textBuffer = "";
        }
        toolCallList.push({ name: event.toolName, args: event.args });
        break;

      case "tool_call_end": {
        const last = toolCallList[toolCallList.length - 1];
        if (last) {
          last.result = event.result;
          segments.push({
            type: "tool",
            name: last.name,
            args: last.args,
            result: event.result,
          });
        }
        break;
      }

      case "tool_call_error": {
        const last = toolCallList[toolCallList.length - 1];
        if (last) {
          last.error = event.error;
          segments.push({
            type: "tool",
            name: last.name,
            args: last.args,
            error: event.error,
          });
        }
        break;
      }
    }

    res.write(`data: ${JSON.stringify(event)}\n\n`);
    // 强制刷新响应缓冲区
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };

  try {
    await runAgentLoop(message, config, emit, history);
    emit({ type: "done" });
  } catch (e: unknown) {
    emit({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    // 保存剩余文本缓冲区
    if (textBuffer) {
      segments.push({ type: "text", content: textBuffer });
    }

    // 按片段顺序保存到数据库，保留文本与工具调用的交错顺序
    for (const seg of segments) {
      if (seg.type === "text") {
        saveMessage(sid, "assistant", seg.content);
      } else {
        saveMessage(sid, "assistant", "",
          JSON.stringify([{ name: seg.name, args: seg.args, result: seg.result, error: seg.error }])
        );
      }
    }

    // 自动生成标题（仅首次对话）
    const currentTitle = getSessionTitle(sid);
    if (currentTitle === "新对话") {
      try {
        const titleConfig = { ...config, model: "deepseek-chat" };
        const generated = await chatComplete(titleConfig, [
          { role: "system", content: "你是一个助手，用不超过12个字概括用户意图。只输出标题，不要引号、不要解释。" },
          { role: "user", content: message },
        ]);
        const title = generated.trim().slice(0, 30) || message.slice(0, 15);
        updateSessionTitle(sid, title);
        // 通知前端标题已更新
        res.write(`data: ${JSON.stringify({ type: "title_updated", sessionId: sid, title })}\n\n`);
      } catch {
        // 命名失败不阻塞主流程，用首条消息前15字兜底
        const fallback = message.slice(0, 15).replace(/\n/g, " ") || "新对话";
        updateSessionTitle(sid, fallback);
        res.write(`data: ${JSON.stringify({ type: "title_updated", sessionId: sid, title: fallback })}\n\n`);
      }
    }

    // 通知前端会话 ID
    res.write(`data: ${JSON.stringify({ type: "session_created", sessionId: sid })}\n\n`);
    res.end();
  }
});

// 健康检查
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = Number(process.env.PORT) || 3456;
app.listen(PORT, () => {
  console.log(`SywayClaw server running on http://localhost:${PORT}`);
});
