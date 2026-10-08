/**
 * Agent 主循环 —— 本项目最核心的文件
 *
 * ============================================================
 * 为什么需要「循环」而不是调一次 LLM？
 * ------------------------------------------------------------
 * 普通聊天：user → LLM → assistant 文本，一轮就结束。
 * Agent：模型可能先返回 tool_calls（「请帮我查一下/算一下」），
 *        我们本地执行工具，把结果以 role=tool 写回 messages，
 *        再调一次 LLM……如此反复，直到模型给出最终文本（finish_reason=stop）。
 *
 * 伪代码：
 *   messages = [system, ...history, user]
 *   loop:
 *     response = LLM(messages, tools)
 *     append assistant message
 *     if stopReason == "stop":
 *       return final text
 *     if stopReason == "tool_calls":
 *       for each tool_call:
 *         result = execute(tool_call)
 *         append { role: "tool", tool_call_id, content: result }
 *       continue  // 带着工具结果再问 LLM
 *
 * 流式补充：
 *   LLM(...) 在流式模式下会「边生成边回调」（文本 delta、工具调用分片），
 *   本文件把这些回调翻译成 AgentEvent 推给 TUI；但 LLM(...) 的返回值仍是
 *   一条完整的 assistant 消息，所以下面的工具循环与非流式时一模一样。
 * ============================================================
 */

import type OpenAI from "openai";
import { chatOnce } from "./llm.js";
import type { ToolRegistry } from "./tools/index.js";
import type {
  AgentEvent,
  LlmConfig,
  Message,
  ToolCall,
} from "./types.js";

export interface RunAgentOptions {
  client: OpenAI;
  config: LlmConfig;
  /** 可变的对话历史；本函数会原地追加 assistant / tool 消息 */
  messages: Message[];
  tools: ToolRegistry;
  /** 防止模型死循环调工具；教学默认 8 轮足够 */
  maxIterations?: number;
  /**
   * 把中间状态推给 TUI（可选）
   * 学习点：流式相关的回调都汇总成事件——
   *   text_delta（≈ onTextDelta）、tool_call_start（≈ onToolCallStart）、
   *   tool_end（≈ onToolResult）等，UI 只需一个 switch 即可处理。
   */
  onEvent?: (event: AgentEvent) => void;
}

/**
 * 执行一轮「用户刚说完话」之后的完整 Agent 推理
 * @returns 最终助手文本（可能为空字符串）
 */
export async function runAgentLoop(options: RunAgentOptions): Promise<string> {
  const {
    client,
    config,
    messages,
    tools,
    maxIterations = 8,
    onEvent,
  } = options;

  const emit = (event: AgentEvent) => onEvent?.(event);
  const toolList = tools.list();

  for (let i = 0; i < maxIterations; i++) {
    emit({ type: "status", text: `正在调用模型（第 ${i + 1} 轮）…` });

    let llmResult;
    try {
      // 第 5 个参数是流式钩子：非流式模式下 llm.ts 不会调用它们
      llmResult = await chatOnce(client, config, messages, toolList, {
        onTextDelta: (text) => emit({ type: "text_delta", text }),
        onToolCallStart: (index, name) => emit({ type: "tool_call_start", index, name }),
        onToolCallDelta: (index, name, argsLength) =>
          emit({ type: "tool_call_delta", index, name, argsLength }),
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      emit({ type: "error", text });
      throw err;
    }

    // 本轮 LLM 输出已完整：通知 UI 归档（流式时把「正在输入」区的文本落入消息列表）
    emit({
      type: "llm_turn_end",
      content: llmResult.message.content ?? "",
      hasToolCalls: Boolean(llmResult.message.tool_calls?.length),
    });

    // 无论是否要调工具，先把 assistant 消息写入历史
    // 学习点：没有这条消息，后续的 tool 消息就挂不上 tool_call_id。
    messages.push(llmResult.message);

    if (llmResult.stopReason === "error") {
      emit({ type: "error", text: "模型返回空 choices" });
      return "";
    }

    if (llmResult.stopReason === "length") {
      const text = llmResult.message.content ?? "";
      emit({ type: "error", text: "输出被 max_tokens 截断，请缩短问题或增大上限" });
      emit({ type: "done", finalText: text });
      return text;
    }

    // 最终文本：循环结束
    if (llmResult.stopReason === "stop" || !llmResult.message.tool_calls?.length) {
      const finalText = llmResult.message.content ?? "";
      emit({ type: "done", finalText });
      return finalText;
    }

    // ---- 需要执行工具 ----
    const calls = llmResult.message.tool_calls;
    for (const call of calls) {
      const result = await executeOneTool(call, tools, emit);
      // 学习点：role=tool 的消息是「工具执行结果」的标准写法；
      // tool_call_id 必须与 assistant.tool_calls[].id 对应。
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
    }
    // 继续 for 循环 → 带着工具结果再次调用 LLM
  }

  const msg = `已达到最大迭代次数（${maxIterations}），强制结束。`;
  emit({ type: "error", text: msg });
  emit({ type: "done", finalText: msg });
  return msg;
}

/** 解析参数并执行单个工具；任何错误都转成字符串结果，避免打断整个 loop */
async function executeOneTool(
  call: ToolCall,
  tools: ToolRegistry,
  emit: (e: AgentEvent) => void,
): Promise<string> {
  const name = call.function.name;
  const argsRaw = call.function.arguments;

  emit({ type: "tool_start", name, args: argsRaw, id: call.id });

  let result: string;
  try {
    let args: Record<string, unknown> = {};
    try {
      args = argsRaw ? (JSON.parse(argsRaw) as Record<string, unknown>) : {};
    } catch {
      result = `错误：工具参数不是合法 JSON：${argsRaw}`;
      emit({ type: "tool_end", name, result, id: call.id });
      return result;
    }

    const tool = tools.get(name);
    if (!tool) {
      result = `错误：未知工具 "${name}"。可用工具：${tools.listNames().join(", ")}`;
    } else {
      result = await tool.execute(args);
    }
  } catch (err) {
    result = `错误：执行工具 ${name} 失败：${err instanceof Error ? err.message : String(err)}`;
  }

  emit({ type: "tool_end", name, result, id: call.id });
  return result;
}

/** 默认 system prompt：告诉模型自己有哪些能力 */
export function defaultSystemPrompt(toolNames: string[]): Message {
  return {
    role: "system",
    content: [
      "你是一个教学演示用的终端 Agent。",
      "你可以调用工具来帮助用户；需要精确信息（时间、文件、计算）时优先用工具。",
      "当用户要求编写、生成或修改代码/文档时，使用 write_file 写入项目工作区（相对路径）；写完后可用 read_file 核对。",
      "不要尝试写入 .env、node_modules、.git 或密钥文件；这些会被工具拒绝。",
      `可用工具：${toolNames.join(", ")}`,
      "用简洁中文回答；工具结果已经够用时直接给出最终答案。",
    ].join("\n"),
  };
}
