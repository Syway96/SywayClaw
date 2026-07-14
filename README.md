# SywayClaw

本地 AI 编程助手，基于 DeepSeek API。

## 快速启动

```bash
# 1. 安装依赖
cd server && npm install
cd ../client && npm install

# 2. 启动后端（终端 1）
cd server && npm run dev

# 3. 启动前端（终端 2）
cd client && npm run dev
```

打开 `http://localhost:5173`，右上角设置填入 DeepSeek API Key 即可使用。

## 可用工具

`read_file` · `read_lines` · `write_file` · `delete_file` · `create_directory` · `list_directory` · `search_files` · `grep_code` · `get_file_info` · `run_command` · `web_fetch` · `web_search`

详见 [工具参考.md](./工具参考.md)

## 技术栈

前端：React + Vite + TypeScript
后端：Express + TypeScript
存储：SQLite（`data/sywayclaw.db`）
