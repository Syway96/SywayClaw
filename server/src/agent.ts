import { chatStream, type LlmConfig, type ToolCall } from "./llm.js";
import { executeTool, getToolSchemas, type ToolResult } from "./tools.js";
import type { EventSink } from "./events.js";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

const MAX_TURNS = 100;

/**
 * Agent 核心循环：用户输入 → LLM → 工具调用 → 循环 → 最终回复
 */
export async function runAgentLoop(
  userMessage: string,
  config: LlmConfig,
  emit: EventSink,
  history?: Array<{ role: string; content: string }>,
): Promise<string> {
  emit({ type: "agent_start" });

  const messages: Message[] = [];

  if (config.systemPrompt) {
    messages.push({ role: "system", content: config.systemPrompt });
  }

  // 注入历史消息上下文
  if (history?.length) {
    for (const h of history) {
      if (h.role === "user" || h.role === "assistant") {
        messages.push({ role: h.role, content: h.content });
      }
    }
  }

  messages.push({ role: "user", content: userMessage });

  let finalReply = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const availableTools = getToolSchemas();

    let hasToolCalls = false;
    let currentText = "";
    let currentThinking = "";

    for await (const event of chatStream(config, messages, availableTools)) {
      switch (event.type) {
        case "text_delta":
          currentText += event.text;
          emit({ type: "text_delta", text: event.text });
          break;

        case "thinking_delta":
          currentThinking += event.text;
          emit({ type: "thinking_delta", text: event.text });
          break;

        case "tool_call_delta": {
          hasToolCalls = true;
          const tc = event.call;
          const toolName = tc.function.name;

          emit({
            type: "tool_call_start",
            toolCallId: tc.id,
            toolName,
            args: tc.function.arguments,
          });

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            // JSON 解析失败时使用原始参数
          }

          const startTime = Date.now();
          let result: ToolResult;
          try {
            result = await executeTool(toolName, args);
          } catch (e: unknown) {
            result = {
              content: "",
              error: e instanceof Error ? e.message : String(e),
            };
          }
          const durationMs = Date.now() - startTime;

          if (result.error) {
            emit({
              type: "tool_call_error",
              toolCallId: tc.id,
              toolName,
              error: result.error,
            });
          } else {
            emit({
              type: "tool_call_end",
              toolCallId: tc.id,
              toolName,
              result: result.content,
              durationMs,
            });
          }

          // 添加 assistant 消息（含 tool_calls 和思考内容）
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [tc],
            reasoning_content: currentThinking,
          });

          // 添加工具结果消息
          messages.push({
            role: "tool",
            content: result.error ?? result.content,
            tool_call_id: tc.id,
            name: toolName,
          });
          break;
        }

        case "done":
          break;

        case "error":
          emit({ type: "error", message: event.message });
          emit({ type: "agent_end" });
          return "";
      }
    }

    // 没有工具调用 → 对话结束
    if (!hasToolCalls) {
      if (currentText) {
        // 将 assistant 文本加入历史
        messages.push({ role: "assistant", content: currentText });
      }
      finalReply = currentText;
      break;
    }
  }

  emit({ type: "agent_end" });
  return finalReply;
}
