// DeepSeek API（兼容 OpenAI 协议）
const BASE_URL = "https://api.deepseek.com/v1";

export interface LlmConfig {
  apiKey: string;
  model: string;         // 例如 "deepseek-chat", "deepseek-reasoner"
  systemPrompt?: string;
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

// LLM 流式事件类型
export type LlmEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call_delta"; call: ToolCall }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };

/**
 * 调用 DeepSeek API，流式返回 (SSE)
 * 返回一个 LlmEvent 异步生成器
 */
export async function* chatStream(
  config: LlmConfig,
  messages: Array<{ role: string; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string; reasoning_content?: string }>,
  tools?: ToolDef[],
): AsyncGenerator<LlmEvent> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  };
  if (tools?.length) body.tools = tools;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    yield { type: "error", message: `API error ${res.status}: ${errText}` };
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    yield { type: "error", message: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  // 增量构建中的工具调用
  const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          // 在结束前发出已积累的工具调用
          for (const tc of toolCallsMap.values()) {
            if (tc.name) {
              yield {
                type: "tool_call_delta",
                call: { id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args } },
              };
            }
          }
          yield { type: "done", finishReason: "stop" };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const { delta, finish_reason } = choice;

          // 推理内容（deepseek-reasoner 的 thinking）
          if (delta?.reasoning_content) {
            yield { type: "thinking_delta", text: delta.reasoning_content };
          }

          // 普通文本内容
          if (delta?.content) {
            yield { type: "text_delta", text: delta.content };
          }

          // 工具调用（流式分块传入）
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallsMap.get(idx);
              if (!existing) {
                toolCallsMap.set(idx, {
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  args: tc.function?.arguments ?? "",
                });
              } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
              }
            }
          }

          if (finish_reason && finish_reason !== "stop") {
            // 在结束前发出已积累的工具调用
            for (const tc of toolCallsMap.values()) {
              if (tc.name) {
                yield {
                  type: "tool_call_delta",
                  call: { id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args } },
                };
              }
            }
            yield { type: "done", finishReason: finish_reason };
            return;
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // 发出所有已积累的工具调用
  for (const tc of toolCallsMap.values()) {
    if (tc.name) {
      yield {
        type: "tool_call_delta",
        call: { id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args } },
      };
    }
  }

  yield { type: "done", finishReason: "stop" };
}

/**
 * 非流式聊天补全（用于简单任务）
 */
export async function chatComplete(
  config: LlmConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
