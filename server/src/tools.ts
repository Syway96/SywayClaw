import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDef } from "./llm.js";

const execAsync = promisify(exec);

export interface ToolResult {
  content: string;
  error?: string;
}

export interface Tool {
  schema: ToolDef;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? process.cwd();

// 解析相对工作区的文件路径，防止越权访问
function safePath(userPath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, userPath);
  if (!resolved.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error(`Path escapes workspace: ${userPath}`);
  }
  return resolved;
}

// ===================== 工具注册表 =====================
const toolRegistry = new Map<string, Tool>();

function registerTool(tool: Tool) {
  toolRegistry.set(tool.schema.function.name, tool);
}

// 获取所有工具定义（供 LLM 请求使用，自动从注册表生成）
export function getToolSchemas(): ToolDef[] {
  return [...toolRegistry.values()].map((t) => t.schema);
}

// 按名称执行单个工具（自动从注册表查找）
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = toolRegistry.get(name);
  if (!tool) {
    return { content: "", error: `未知工具: ${name}` };
  }
  return tool.execute(args);
}

// ===================== 文件读取 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文件内容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const filePath = safePath(String(args.path));
    const content = await fs.readFile(filePath, "utf-8");
    return { content };
  },
});

// ===================== 文件写入 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description: "写入或覆盖文件内容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "要写入的内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args) {
    const filePath = safePath(String(args.path));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, String(args.content), "utf-8");
    return { content: `文件已写入: ${filePath}` };
  },
});

// ===================== 命令执行 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "run_command",
      description: "在工作区中执行 Shell 命令",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
        },
        required: ["command"],
      },
    },
  },
  async execute(args) {
    let cmd = String(args.command);

    // Windows 兼容：将 && 替换为 ; (PowerShell 语法)
    if (process.platform === "win32") {
      cmd = cmd.replace(/&&/g, ";");
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: WORKSPACE_ROOT,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      return { content: stdout || stderr || "(无输出)" };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return {
        content: err.stdout ?? "",
        error: err.stderr || err.message || "命令执行失败",
      };
    }
  },
});

// ===================== 目录列表 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "list_directory",
      description: "列出目录中的文件和子目录",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径，默认为工作区根目录" },
        },
      },
    },
  },
  async execute(args) {
    const dirPath = args.path ? safePath(String(args.path)) : WORKSPACE_ROOT;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const lines = entries.map((e) => {
      const type = e.isDirectory() ? "📁" : "📄";
      return `${type} ${e.name}`;
    });
    return { content: lines.join("\n") || "(空目录)" };
  },
});

// ===================== 搜索文件 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "search_files",
      description: "按 glob 模式搜索匹配的文件",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式，如 **/*.ts" },
          path: { type: "string", description: "搜索起始目录，默认为工作区根目录" },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args) {
    const root = args.path ? safePath(String(args.path)) : WORKSPACE_ROOT;
    const pattern = String(args.pattern);

    const results: string[] = [];
    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
          await walk(full);
        } else if (e.isFile()) {
          results.push(path.relative(root, full));
        }
      }
    }

    // 简易 glob 匹配
    const regex = new RegExp(
      "^" + pattern
        .replace(/\*\*/g, "§§RECURSIVE§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§RECURSIVE§§/g, ".*")
        .replace(/\?/g, "[^/]")
      + "$"
    );

    await walk(root);
    const matches = results.filter((f) => regex.test(f));
    return { content: matches.slice(0, 200).join("\n") || "(无匹配文件)" };
  },
});

// ===================== 内容搜索 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "grep_code",
      description: "在文件内容中搜索正则匹配的行",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式" },
          path: { type: "string", description: "搜索起始目录，默认为工作区根目录" },
          glob: { type: "string", description: "文件名过滤，如 *.ts" },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args) {
    const root = args.path ? safePath(String(args.path)) : WORKSPACE_ROOT;
    const pattern = String(args.pattern);
    const fileGlob = args.glob ? String(args.glob) : null;

    const regex = new RegExp(pattern, "gi");
    const results: string[] = [];
    const fileRegex = fileGlob
      ? new RegExp("^" + fileGlob.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$")
      : null;

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
          await walk(full);
        } else if (e.isFile()) {
          const rel = path.relative(root, full);
          if (fileRegex && !fileRegex.test(rel)) continue;
          try {
            const content = await fs.readFile(full, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              }
            }
          } catch {
            // 跳过无法读取的文件
          }
        }
      }
    }

    await walk(root);
    return { content: results.slice(0, 100).join("\n") || "(无匹配结果)" };
  },
});

// ===================== 删除文件 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "delete_file",
      description: "删除指定文件",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "要删除的文件路径" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const filePath = safePath(String(args.path));
    await fs.unlink(filePath);
    return { content: `文件已删除: ${filePath}` };
  },
});

// ===================== 文件信息 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "get_file_info",
      description: "获取文件的大小、修改时间等信息",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const filePath = safePath(String(args.path));
    const stat = await fs.stat(filePath);
    const info = [
      `路径: ${filePath}`,
      `大小: ${(stat.size / 1024).toFixed(1)} KB`,
      `修改时间: ${stat.mtime.toISOString()}`,
      `类型: ${stat.isDirectory() ? "目录" : "文件"}`,
    ];
    return { content: info.join("\n") };
  },
});

// ===================== 创建目录 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "create_directory",
      description: "创建新目录（自动创建父目录）",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const dirPath = safePath(String(args.path));
    await fs.mkdir(dirPath, { recursive: true });
    return { content: `目录已创建: ${dirPath}` };
  },
});

// ===================== 网页抓取 =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "web_fetch",
      description: "抓取网页内容（返回纯文本）",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "目标 URL" },
        },
        required: ["url"],
      },
    },
  },
  async execute(args) {
    const url = String(args.url);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "SywayClaw/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return { content: "", error: `HTTP ${res.status}` };
      }
      const html = await res.text();
      // 简易提取文本：去标签、合并空白
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join("\n")
        .slice(0, 8000);
      return { content: text || "(空白页面)" };
    } catch (e: unknown) {
      return { content: "", error: `抓取失败: ${(e as Error).message}` };
    }
  },
});

// ===================== 网页搜索（Bing） =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "web_search",
      description: "搜索网页（使用 Bing）",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = encodeURIComponent(String(args.query));
    try {
      const res = await fetch(
        `https://www.bing.com/search?q=${query}&setlang=zh-cn`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9",
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        return { content: "", error: `搜索失败: HTTP ${res.status}` };
      }

      const html = await res.text();

      // 提取搜索结果：匹配 <li class="b_algo"> 块
      const results: string[] = [];
      const algoRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
      let match;
      let count = 0;

      while ((match = algoRegex.exec(html)) !== null && count < 8) {
        const block = match[1];

        // 提取标题
        const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        const title = titleMatch
          ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
          : "(无标题)";

        // 提取链接
        const urlMatch = block.match(/<a[^>]*href="([^"]*)"/i);
        const url = urlMatch ? urlMatch[1] : "";

        // 提取摘要
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 200)
          : "";

        if (title !== "(无标题)" || snippet) {
          results.push(`${count + 1}. ${title}`);
          if (snippet) results.push(`   ${snippet}`);
          if (url) results.push(`   ${url}`);
          results.push("");
          count++;
        }
      }

      return { content: results.join("\n") || "(无搜索结果)" };
    } catch (e: unknown) {
      return { content: "", error: `搜索失败: ${(e as Error).message}` };
    }
  },
});

// ===================== 增强的读文件（支持行范围） =====================
registerTool({
  schema: {
    type: "function",
    function: {
      name: "read_lines",
      description: "读取文件的指定行范围（适合大文件分页读取）",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          start: { type: "number", description: "起始行号（从1开始，默认1）" },
          end: { type: "number", description: "结束行号（默认50）" },
        },
        required: ["path"],
      },
    },
  },
  async execute(args) {
    const filePath = safePath(String(args.path));
    const start = typeof args.start === "number" ? Math.max(1, args.start) : 1;
    const end = typeof args.end === "number" ? args.end : start + 49;

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;
    const selected = lines.slice(start - 1, end);

    const result = selected
      .map((line, i) => `${start + i}: ${line}`)
      .join("\n");

    return {
      content: result + `\n\n(第 ${start}-${Math.min(end, totalLines)} 行，共 ${totalLines} 行)`,
    };
  },
});
