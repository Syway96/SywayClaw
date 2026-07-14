import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";

const DATA_DIR = path.resolve(process.cwd(), "../data");
const DB_PATH = path.join(DATA_DIR, "sywayclaw.db");

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db: Database.Database = new Database(DB_PATH);

// 启用 WAL 模式提升并发性能
db.pragma("journal_mode = WAL");

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '新对话',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    tool_calls TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, id);
`);

// 兼容旧表：如果 tool_calls 列不存在则添加
try {
  db.exec("ALTER TABLE messages ADD COLUMN tool_calls TEXT DEFAULT NULL");
} catch { /* 列已存在 */ }

// ===================== 会话操作 =====================

export interface SessionRow {
  id: string;
  title: string;
  created_at: string;
}

/** 创建新会话 */
export function createSession(id: string, title?: string): SessionRow {
  const stmt = db.prepare(
    "INSERT INTO sessions (id, title) VALUES (?, ?)"
  );
  stmt.run(id, title ?? "新对话");
  return { id, title: title ?? "新对话", created_at: new Date().toISOString() };
}

/** 获取所有会话（按创建时间倒序） */
export function listSessions(): SessionRow[] {
  return db.prepare(
    "SELECT id, title, created_at FROM sessions ORDER BY created_at DESC"
  ).all() as SessionRow[];
}

/** 删除会话及其消息 */
export function deleteSession(id: string): boolean {
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return result.changes > 0;
}

/** 更新会话标题 */
export function updateSessionTitle(id: string, title: string): boolean {
  const result = db.prepare(
    "UPDATE sessions SET title = ? WHERE id = ?"
  ).run(title, id);
  return result.changes > 0;
}

// ===================== 消息操作 =====================

export interface MessageRow {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: string | null;
  created_at: string;
}

/** 保存一条消息 */
export function saveMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  toolCallsJson?: string,
): MessageRow {
  const stmt = db.prepare(
    "INSERT INTO messages (session_id, role, content, tool_calls) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(sessionId, role, content, toolCallsJson ?? null);
  return {
    id: result.lastInsertRowid as number,
    session_id: sessionId,
    role,
    content,
    tool_calls: toolCallsJson ?? null,
    created_at: new Date().toISOString(),
  };
}

/** 获取会话的所有消息（按时间正序） */
export function getSessionMessages(sessionId: string): MessageRow[] {
  return db.prepare(
    "SELECT id, session_id, role, content, tool_calls, created_at FROM messages WHERE session_id = ? ORDER BY id ASC"
  ).all(sessionId) as MessageRow[];
}

/** 获取会话标题 */
export function getSessionTitle(sessionId: string): string | null {
  const row = db.prepare(
    "SELECT title FROM sessions WHERE id = ?"
  ).get(sessionId) as { title: string } | undefined;
  return row?.title ?? null;
}

export default db;
