import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { useStore, type ToolCallEntry } from "./store.js";

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

export default function ChatPanel() {
  const messages = useStore((s) => s.messages);
  const isRunning = useStore((s) => s.isRunning);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

          return (
            <div key={msg.id} className={`msg-row ${msg.role === "user" ? "msg-row--user" : ""}`}>
              <div className={bubbleClass}>
                {msg.role === "user" ? (
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
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
