import { useState, useEffect } from "react";
import { useStore } from "./store.js";

const MODELS = [
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
];

export default function Settings() {
  const show = useStore((s) => s.showSettings);
  const toggle = useStore((s) => s.toggleSettings);
  const apiKey = useStore((s) => s.apiKey);
  const setApiKey = useStore((s) => s.setApiKey);
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const systemPrompt = useStore((s) => s.systemPrompt);
  const setSystemPrompt = useStore((s) => s.setSystemPrompt);
  const [showDefault, setShowDefault] = useState(false);
  const [defaultPrompt, setDefaultPrompt] = useState("");

  // 从服务器获取实际内置提示词（单一数据源）
  useEffect(() => {
    if (show) {
      fetch("/api/default-prompt")
        .then((r) => r.json())
        .then((d) => setDefaultPrompt(d.prompt))
        .catch(() => setDefaultPrompt(""));
    }
  }, [show]);

  if (!show) return null;

  return (
    <>
      <div className="settings-backdrop" onClick={toggle} />
      <div className="settings-drawer">
        <div className="settings-drawer__head">
          <h2 className="settings-drawer__title">设置</h2>
          <button className="icon-btn" onClick={toggle}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="settings-drawer__body">
          <div className="settings-field">
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>

          <div className="settings-field">
            <label>模型</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="settings-field">
            <label>系统提示词</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="留空则使用下方内置提示词"
              rows={5}
            />
            <span className="settings-hint">
              {systemPrompt.trim()
                ? "使用自定义提示词"
                : "当前为空，将使用内置提示词"}
            </span>
            <button
              className="settings-toggle-btn"
              onClick={() => setShowDefault(!showDefault)}
            >
              {showDefault ? "隐藏" : "查看"}内置提示词
            </button>
            {showDefault && (
              <pre className="settings-default-preview">{defaultPrompt || "加载中..."}</pre>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
