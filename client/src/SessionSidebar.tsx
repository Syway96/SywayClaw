import { useEffect, useRef, useState } from "react";
import { useStore } from "./store.js";

export default function SessionSidebar() {
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const fetchSessions = useStore((s) => s.fetchSessions);
  const createSession = useStore((s) => s.createSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const switchSession = useStore((s) => s.switchSession);
  const renameSession = useStore((s) => s.renameSession);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!menuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuId]);

  const handleNew = async () => {
    await createSession();
  };

  const startEdit = (id: string, title: string) => {
    setMenuId(null);
    setEditingId(id);
    setEditValue(title);
  };

  const commitEdit = async () => {
    if (editingId && editValue.trim()) {
      await renameSession(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    setMenuId(null);
    await deleteSession(id);
  };

  if (collapsed) {
    return (
      <div className="sidebar sidebar--collapsed">
        <button className="panel-toggle" onClick={() => setCollapsed(false)} title="展开对话">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__title">对话</span>
        <div className="sidebar__head-actions">
          <button className="sidebar__new-btn" onClick={handleNew} title="新建对话">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
          <button className="panel-toggle" onClick={() => setCollapsed(true)} title="折叠对话">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="sidebar__list">
        {sessions.length === 0 && (
          <div className="sidebar__empty">暂无对话</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`sidebar__item ${s.id === currentSessionId ? "sidebar__item--active" : ""}`}
            onClick={() => switchSession(s.id)}
          >
            {editingId === s.id ? (
              <input
                ref={editRef}
                className="sidebar__edit-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="sidebar__item-title">{s.title}</span>
            )}

            <div className="sidebar__menu-wrap" ref={menuId === s.id ? menuRef : undefined}>
              <button
                className="sidebar__more-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuId(menuId === s.id ? null : s.id);
                }}
                title="更多"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2"/>
                  <circle cx="12" cy="12" r="2"/>
                  <circle cx="12" cy="19" r="2"/>
                </svg>
              </button>
              {menuId === s.id && (
                <div className="sidebar__menu" onClick={(e) => e.stopPropagation()}>
                  <button className="sidebar__menu-item" onClick={() => startEdit(s.id, s.title)}>
                    重命名
                  </button>
                  <button className="sidebar__menu-item sidebar__menu-item--danger" onClick={() => handleDelete(s.id)}>
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
