// 通过 SSE 推送给前端的事件类型

export type ServerEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call_start"; toolCallId: string; toolName: string; args: string }
  | { type: "tool_call_end"; toolCallId: string; toolName: string; result: string; durationMs: number }
  | { type: "tool_call_error"; toolCallId: string; toolName: string; error: string }
  | { type: "plan_update"; tasks: Array<{ id: string; content: string; status: "pending" | "in_progress" | "done" }> }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "session_created"; sessionId: string }
  | { type: "title_updated"; sessionId: string; title: string };

export type EventSink = (event: ServerEvent) => void;
