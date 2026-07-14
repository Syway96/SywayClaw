import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { useStore, type ToolCallEntry } from "./store.js";
import type { ServerEvent } from "../../server/src/events.js";

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    // 安全起见用 DOMPurify 处理，但这里信任 LLM 输出
    return marked.parse(text) as string;
  }, [text]);

  return (
    <div
      className="markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ToolCallInline({ tc }: { tc: ToolCallEntry }) {
  const [open, setOpen] = useState(false);
  const color = tc.status === "running" ? "var(--warning)" : tc.status === "error" ? "var(--danger)" : "var(--success)";
  const label = tc.status === "running" ? "执行中" : tc.status === "error" ? "失败" : "完成";

  return (
    <div className="tool-inline">
      <div className="tool-inline__header" onClick={() => setOpen(!open)}>
        <span className="tool-inline__name">
          <span className={`tool-dot tool-dot--${tc.status}`} />
          <span style={{ color }}>{tc.name}</span>
        </span>
        <span className="tool-inline__status" style={{ color }}>
          {label}{tc.durationMs ? ` · ${tc.durationMs}ms` : ""}
        </span>
      </div>
      {open && (
        <div className="tool-inline__body">
          <div className="tool-inline__label">参数</div>
          <div className="tool-inline__value">{tc.args}</div>
          {tc.result && (
            <>
              <div className="tool-inline__label" style={{ marginTop: 8 }}>结果</div>
              <div className="tool-inline__value">{tc.result}</div>
            </>
          )}
          {tc.error && (
            <>
              <div className="tool-inline__label" style={{ marginTop: 8 }}>错误</div>
              <div className="tool-inline__value" style={{ color: "var(--danger)" }}>{tc.error}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MsgActions({ onCopy, onEdit }: { onCopy: () => void; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const copyIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  );

  const checkIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );

  return (
    <div className="msg-actions">
      <button className={`msg-action-btn${copied ? " msg-action-btn--done" : ""}`} onClick={handleCopy} title="复制">
        {copied ? checkIcon : copyIcon}
      </button>
      {onEdit && (
        <button className="msg-action-btn" onClick={onEdit} title="编辑">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      )}
    </div>
  );
}

export default function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const isRunning = useStore((s) => s.isRunning);
  const editMessage = useStore((s) => s.editMessage);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleEditSave = (id: string) => {
    const newContent = editInputRef.current?.value.trim();
    if (newContent) {
      editMessage(id, newContent);
      // 重新发送编辑后的消息
      const s = useStore.getState();
      s.setRunning(true);
      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: newContent,
          apiKey: s.apiKey,
          model: s.model,
          systemPrompt: s.systemPrompt,
          sessionId: s.currentSessionId,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(await res.text());
          }
          // 使用 SSE 读取回复
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const json = line.slice(6);
                try {
                  const event: ServerEvent = JSON.parse(json);
                  useStore.getState().handleEvent(event);
                } catch { /* 忽略解析错误 */ }
              }
            }
          }
        })
        .catch((err) => {
          const content = err instanceof Error ? err.message : String(err);
          useStore.getState().handleEvent({ type: "error", message: content });
        })
        .finally(() => {
          useStore.getState().setRunning(false);
        });
    }
    setEditingId(null);
  };

  const handleEditCancel = () => {
    setEditingId(null);
  };

  if (messages.length === 0) {
    return (
      <div className="chat-panel">
        <div className="chat-messages">
          <div className="chat-empty">
            <div className="chat-empty__icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
                <path d="M8 14v-2a4 4 0 0 1 8 0v2"/>
                <circle cx="12" cy="14" r="8"/>
                <circle cx="9" cy="13" r="1" fill="currentColor"/>
                <circle cx="15" cy="13" r="1" fill="currentColor"/>
                <path d="M9 17c.83.67 1.83 1 3 1s2.17-.33 3-1"/>
              </svg>
            </div>
            <div className="chat-empty__title">SywayClaw</div>
            <div className="chat-empty__sub">点击右上角设置，配置 DeepSeek API Key 后开始对话</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((msg, i) => {
          const isLastAssistant =
            isRunning && msg.role === "assistant" && i === messages.length - 1;
          const bubbleClass =
            msg.role === "user"
              ? "msg-bubble msg-bubble--user"
              : `msg-bubble msg-bubble--assistant${isLastAssistant ? " msg-bubble--active" : ""}`;

          const isEditing = editingId === msg.id;

          return (
            <div key={msg.id} className={`msg-row ${msg.role === "user" ? "msg-row--user" : ""}`}>
              <div className="msg-group">
                <div className={bubbleClass}>
                  {isEditing ? (
                    <div className="msg-edit-area">
                      <textarea
                        ref={editInputRef}
                        className="msg-edit-input"
                        defaultValue={msg.content}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleEditSave(msg.id);
                          } else if (e.key === "Escape") {
                            handleEditCancel();
                          }
                        }}
                        autoFocus
                      />
                      <div className="msg-edit-bar">
                        <span className="msg-edit-hint">Shift+Enter 换行</span>
                        <button className="msg-edit-btn msg-edit-btn--cancel" onClick={handleEditCancel}>取消</button>
                        <button className="msg-edit-btn msg-edit-btn--save" onClick={() => handleEditSave(msg.id)}>保存</button>
                      </div>
                    </div>
                  ) : msg.role === "user" ? (
                    <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                  ) : (
                    <>
                      {msg.thinking && (
                        <details className="thinking-block">
                          <summary>思考过程</summary>
                          <div className="thinking-block__content">{msg.thinking}</div>
                        </details>
                      )}
                      {msg.content && <Markdown text={msg.content} />}
                      {msg.content === "" && !msg.thinking && !msg.toolCalls?.length && (
                        <span className="loading-dots" style={{ color: "var(--text-tertiary)" }}>思考中</span>
                      )}
                      {msg.toolCalls?.map((tc) => (
                        <ToolCallInline key={tc.id} tc={tc} />
                      ))}
                    </>
                  )}
                </div>
                {!isEditing && (
                  <MsgActions
                    onCopy={() => handleCopy(msg.content)}
                    onEdit={msg.role === "user" ? () => setEditingId(msg.id) : undefined}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
