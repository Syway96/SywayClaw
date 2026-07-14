import { useState } from "react";
import { useStore, type ToolCallEntry } from "./store.js";

export default function ExecPanel() {
  const toolCalls = useStore((s) => s.toolCalls);
  const isRunning = useStore((s) => s.isRunning);
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="exec-panel exec-panel--collapsed">
        <button className="panel-toggle" onClick={() => setCollapsed(false)} title="展开工具调用">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="exec-panel">
      <div className="exec-panel__head">
        <button className="panel-toggle" onClick={() => setCollapsed(true)} title="折叠工具调用">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
        <span className="exec-panel__title">工具调用</span>
        <div className="exec-panel__head-right">
          {isRunning && <span className="exec-panel__badge">运行中</span>}
        </div>
      </div>
      <div className="exec-panel__list">
        {toolCalls.length === 0 && (
          <div className="exec-panel__empty">
            {isRunning ? "等待工具调用..." : "暂无调用记录"}
          </div>
        )}
        {toolCalls.map((tc) => (
          <ExecItem key={tc.id} tc={tc} />
        ))}
      </div>
    </div>
  );
}

function ExecItem({ tc }: { tc: ToolCallEntry }) {
  const color = tc.status === "running" ? "var(--warning)" : tc.status === "error" ? "var(--danger)" : "var(--success)";

  return (
    <div className="exec-item">
      <div className="exec-item__top">
        <span className="exec-item__name" style={{ color }}>{tc.name}</span>
        <span className="exec-item__meta">
          <span className={`tool-dot tool-dot--${tc.status}`} style={{ display: "inline-block", marginRight: 4, verticalAlign: "middle" }} />
          {tc.durationMs ? `${tc.durationMs}ms` : ""}
        </span>
      </div>
      <div className="exec-item__args">{tc.args}</div>
      {tc.result && <div className="exec-item__result">{tc.result}</div>}
      {tc.error && <div className="exec-item__result" style={{ color: "var(--danger)" }}>{tc.error}</div>}
    </div>
  );
}
