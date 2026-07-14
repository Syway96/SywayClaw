import { create } from "zustand";
import type { ServerEvent } from "../../server/src/events.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  toolCalls?: ToolCallEntry[];
}

export interface ToolCallEntry {
  id: string;
  name: string;
  args: string;
  result?: string;
  error?: string;
  durationMs?: number;
  status: "running" | "done" | "error";
}

export interface SessionItem {
  id: string;
  title: string;
  created_at: string;
}

interface AppState {
  messages: ChatMessage[];
  isRunning: boolean;
  toolCalls: ToolCallEntry[];
  apiKey: string;
  model: string;
  systemPrompt: string;
  showSettings: boolean;
  sessions: SessionItem[];
  currentSessionId: string | null;

  addUserMessage: (content: string) => void;
  handleEvent: (event: ServerEvent) => void;
  setRunning: (v: boolean) => void;
  setApiKey: (k: string) => void;
  setModel: (m: string) => void;
  setSystemPrompt: (p: string) => void;
  toggleSettings: () => void;

  // 会话管理
  fetchSessions: () => Promise<void>;
  createSession: () => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  setCurrentSessionId: (id: string | null) => void;
}

let msgId = 0;
function nextId() {
  return String(++msgId);
}

export const useStore = create<AppState>((set, get) => ({
  messages: [],
  isRunning: false,
  toolCalls: [],
  apiKey: localStorage.getItem("sywayclaw_apiKey") ?? "",
  model: localStorage.getItem("sywayclaw_model") ?? "deepseek-v4-pro",
  systemPrompt: localStorage.getItem("sywayclaw_systemPrompt") ?? "",
  showSettings: false,
  sessions: [],
  currentSessionId: null,

  addUserMessage(content) {
    set((s) => ({
      messages: [...s.messages, { id: nextId(), role: "user" as const, content }],
      toolCalls: [],
    }));
  },

  handleEvent(event) {
    set((s) => {
      const msgs = s.messages.map((m) => ({ ...m, toolCalls: m.toolCalls ? [...m.toolCalls] : undefined }));
      const last = msgs[msgs.length - 1];
      const toolCalls = s.toolCalls.map((tc) => ({ ...tc }));

      switch (event.type) {
        case "agent_start": {
          msgs.push({ id: nextId(), role: "assistant", content: "", toolCalls: undefined });
          break;
        }

        case "text_delta": {
          // 从工具切换回文本：新建消息
          const cur = msgs[msgs.length - 1];
          if (cur?.role === "assistant" && cur.toolCalls?.length) {
            msgs.push({ id: nextId(), role: "assistant", content: event.text, toolCalls: undefined });
          } else if (cur?.role === "assistant") {
            cur.content += event.text;
          }
          break;
        }

        case "thinking_delta": {
          // 从工具切换回思考：新建消息
          const cur = msgs[msgs.length - 1];
          if (cur?.role === "assistant" && cur.toolCalls?.length) {
            const newMsg = { id: nextId(), role: "assistant" as const, content: "", thinking: event.text, toolCalls: undefined };
            msgs.push(newMsg);
          } else if (cur?.role === "assistant") {
            cur.thinking = (cur.thinking ?? "") + event.text;
          }
          break;
        }

        case "tool_call_start": {
          const entry: ToolCallEntry = {
            id: event.toolCallId,
            name: event.toolName,
            args: event.args,
            status: "running",
          };
          toolCalls.push(entry);

          // 从文本切换到工具：新建消息
          const cur = msgs[msgs.length - 1];
          if (cur?.role === "assistant" && cur.content && !cur.toolCalls?.length) {
            const toolMsg = { id: nextId(), role: "assistant" as const, content: "", toolCalls: [entry] };
            msgs.push(toolMsg);
          } else if (cur?.role === "assistant") {
            cur.toolCalls = [...(cur.toolCalls ?? []), entry];
          }
          break;
        }

        case "tool_call_end": {
          const idx = toolCalls.findIndex((t) => t.id === event.toolCallId);
          if (idx >= 0) {
            toolCalls[idx] = {
              ...toolCalls[idx],
              result: event.result,
              durationMs: event.durationMs,
              status: "done" as const,
            };
            // 在所有 assistant 消息中查找并更新
            for (const m of msgs) {
              if (m.role === "assistant" && m.toolCalls) {
                const mi = m.toolCalls.findIndex((t) => t.id === event.toolCallId);
                if (mi >= 0) m.toolCalls[mi] = toolCalls[idx];
              }
            }
          }
          break;
        }

        case "tool_call_error": {
          const idx = toolCalls.findIndex((t) => t.id === event.toolCallId);
          if (idx >= 0) {
            toolCalls[idx] = {
              ...toolCalls[idx],
              error: event.error,
              status: "error" as const,
            };
            for (const m of msgs) {
              if (m.role === "assistant" && m.toolCalls) {
                const mi = m.toolCalls.findIndex((t) => t.id === event.toolCallId);
                if (mi >= 0) m.toolCalls[mi] = toolCalls[idx];
              }
            }
          }
          break;
        }

        case "error": {
          const cur = msgs[msgs.length - 1];
          if (cur?.role === "assistant") {
            cur.content += `\n\n**Error:** ${event.message}`;
          }
          break;
        }

        case "session_created": {
          return {
            messages: msgs,
            toolCalls,
            currentSessionId: event.sessionId,
          };
        }

        case "title_updated": {
          // 更新侧边栏中的会话标题
          const updated = s.sessions.map((sess) =>
            sess.id === event.sessionId ? { ...sess, title: event.title } : sess
          );
          return { messages: msgs, toolCalls, sessions: updated };
        }

        case "done":
        case "agent_end":
          break;
      }

      return { messages: msgs, toolCalls };
    });
  },

  setRunning: (v) => set({ isRunning: v }),
  setApiKey: (k) => {
    localStorage.setItem("sywayclaw_apiKey", k);
    set({ apiKey: k });
  },
  setModel: (m) => {
    localStorage.setItem("sywayclaw_model", m);
    set({ model: m });
  },
  setSystemPrompt: (p) => {
    localStorage.setItem("sywayclaw_systemPrompt", p);
    set({ systemPrompt: p });
  },
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),

  // ===== 会话管理 =====

  async fetchSessions() {
    const res = await fetch("/api/sessions");
    const sessions = await res.json();
    set({ sessions });
  },

  async createSession() {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新对话" }),
    });
    const session = await res.json();
    await get().fetchSessions();
    set({ currentSessionId: session.id, messages: [], toolCalls: [] });
    return session.id;
  },

  async deleteSession(id) {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    const s = get();
    if (s.currentSessionId === id) {
      set({ currentSessionId: null, messages: [], toolCalls: [] });
    }
    await get().fetchSessions();
  },

  async switchSession(id) {
    await get().loadSessionMessages(id);
    set({ currentSessionId: id });
  },

  async loadSessionMessages(sessionId) {
    const res = await fetch(`/api/sessions/${sessionId}/messages`);
    const rows = await res.json();
    const messages: ChatMessage[] = rows.map((row: { role: string; content: string; tool_calls?: string | null }) => {
      const msg: ChatMessage = {
        id: nextId(),
        role: row.role as "user" | "assistant",
        content: row.content,
      };
      // 解析工具调用历史
      if (row.tool_calls) {
        try {
          const tcList = JSON.parse(row.tool_calls) as Array<{
            name: string; args: string; result?: string; error?: string;
          }>;
          msg.toolCalls = tcList.map((tc, i) => ({
            id: `${sessionId}-tc-${i}`,
            name: tc.name,
            args: tc.args,
            result: tc.result,
            error: tc.error,
            status: tc.error ? "error" as const : "done" as const,
          }));
        } catch { /* ignore parse errors */ }
      }
      return msg;
    });
    set({ messages, toolCalls: [] });
  },

  setCurrentSessionId(id) {
    set({ currentSessionId: id });
  },

  async renameSession(id, title) {
    await fetch(`/api/sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    // 更新本地列表
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, title } : sess
      ),
    }));
  },
}));
