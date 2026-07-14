import { useState } from "react";
import { useStore } from "./store.js";

const MODELS = [
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
];

const DEFAULT_SYSTEM_PROMPT = [
  "你是 SywayClaw，一个智能编程助手。你运行在用户的本地环境中，拥有以下工具：",
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
].join("\n");

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
              <pre className="settings-default-preview">{DEFAULT_SYSTEM_PROMPT}</pre>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
