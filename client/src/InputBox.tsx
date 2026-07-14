import { useRef, useState, useEffect } from "react";
import { useStore } from "./store.js";

export default function InputBox() {
  const [text, setText] = useState("");
  const isRunning = useStore((s) => s.isRunning);
  const apiKey = useStore((s) => s.apiKey);
  const model = useStore((s) => s.model);
  const systemPrompt = useStore((s) => s.systemPrompt);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const handleEvent = useStore((s) => s.handleEvent);
  const setRunning = useStore((s) => s.setRunning);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整高度 + 滚动外层容器
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
    // 滚动到末尾
    const outer = el.closest(".input-scroll-outer") as HTMLElement | null;
    if (outer) outer.scrollTop = outer.scrollHeight;
  }, [text]);

  const send = async () => {
    const msg = text.trim();
    if (!msg || isRunning || !apiKey) return;
    setText("");

    // 获取当前所有消息作为历史上下文
    const history = useStore.getState().messages
      .filter((m) => m.content || m.toolCalls?.length)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    addUserMessage(msg);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, apiKey, model, systemPrompt, history, sessionId: currentSessionId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        handleEvent({ type: "error", message: `服务器错误 ${res.status}: ${errText}` });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          try {
            handleEvent(JSON.parse(trimmed.slice(6)));
          } catch { /* skip */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") {
        handleEvent({ type: "error", message: String(e) });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  };

  const stop = () => abortRef.current?.abort();

  const canSend = !!text.trim() && !!apiKey && !isRunning;

  return (
    <div className="input-area">
      <div className="input-scroll-outer">
        <div className={`input-row ${isRunning ? "input-row--running" : ""}`}>
          <textarea
            ref={textareaRef}
            className="input-textarea"
            placeholder={apiKey ? "输入消息..." : "请先在设置中配置 API Key"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && canSend) {
                e.preventDefault();
                send();
              }
            }}
            disabled={!apiKey}
            rows={1}
            autoFocus
          />
          {isRunning ? (
            <button className="input-send-btn input-send-btn--stop" onClick={stop}>
              停止
            </button>
          ) : (
            <button
              className={`input-send-btn ${canSend ? "input-send-btn--active" : "input-send-btn--disabled"}`}
              onClick={send}
              disabled={!canSend}
              title="发送"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
