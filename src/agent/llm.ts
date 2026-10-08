/**
 * OpenAI 兼容 Chat Completions 客户端
 *
 * 学习点：
 * - 官方 openai SDK 通过 baseURL 即可指向任意兼容端点（DeepSeek、本地 vLLM、Ollama 等）。
 * - 本文件只负责「发一次请求、把响应规范化」；多轮循环在 loop.ts。
 * - 同时提供两种调用方式：
 *     chatNonStream —— 一次性拿到完整 message（简单、兼容性最好）
 *     chatStream    —— stream: true，边生成边产出增量（体验好，但要自己拼接分片）
 *   两者最终都产出同构的 LlmResponse，所以 loop.ts 的工具循环完全不用关心走的是哪条路。
 *
 * ============================================================
 * 流式原理速记（SSE / delta / tool_calls 分片）
 * ------------------------------------------------------------
 * 1) SSE（Server-Sent Events）：HTTP 响应不一次性结束，而是持续推送多行
 *        data: {...一个 chunk 的 JSON...}
 *        data: {...}
 *        data: [DONE]
 *    openai SDK 已经帮我们解析成 `for await (const chunk of stream)`。
 *
 * 2) delta：每个 chunk 的 choices[0] 里不是完整 message，而是「增量」delta：
 *        { delta: { content: "你" } }
 *        { delta: { content: "好" } }
 *        { delta: {}, finish_reason: "stop" }
 *    文本只需按顺序拼接：content += delta.content。
 *
 * 3) tool_calls 分片：工具调用也被切碎了，而且可能同时有多个调用交错到达。
 *    每个分片带 index，用来标明「这是第几个工具调用的碎片」：
 *        { tool_calls: [{ index: 0, id: "call_a", function: { name: "calculator", arguments: "" } }] }
 *        { tool_calls: [{ index: 0, function: { arguments: "{\"expre" } }] }
 *        { tool_calls: [{ index: 0, function: { arguments: "ssion\":\"1+2\"}" } }] }
 *        { tool_calls: [{ index: 1, id: "call_b", function: { name: "get_current_time", arguments: "{}" } }] }
 *        { delta: {}, finish_reason: "tool_calls" }
 *    拼接规则：按 index 建槽位；id 首次出现时记录；name 通常只出现一次；arguments 一律追加。
 *    注意：arguments 只有在流结束后才是完整 JSON，中途 JSON.parse 会失败——所以工具必须等流读完才执行。
 * ============================================================
 */

import OpenAI, { type ClientOptions } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type {
  LlmConfig,
  LlmResponse,
  Message,
  StopReason,
  StreamHooks,
  ToolCall,
  ToolDefinition,
} from "./types.js";

/**
 * 解析布尔型环境变量
 * 学习点：环境变量永远是字符串，"false" 也是真值，必须显式解析。
 */
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null || value.trim() === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(v)) return false;
  if (["true", "1", "yes", "on"].includes(v)) return true;
  return defaultValue;
}

/** 从环境变量加载配置；缺 key 时给出明确错误，避免 silent fail */
export function loadLlmConfig(): LlmConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "未找到 OPENAI_API_KEY。请复制 .env.example 为 .env 并填写后重试。",
    );
  }
  return {
    apiKey,
    baseURL: (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    ),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    // 默认开启流式；OPENAI_STREAM=false 时回退非流式
    stream: parseBoolEnv(process.env.OPENAI_STREAM, true),
  };
}

/**
 * 创建 SDK 客户端（可复用）
 * 学习点：Node 18+ 自带全局 fetch；优先使用它，避免旧版 node-fetch
 * 在部分 SSE 收尾场景抛出 "Premature close"（内容其实已经收齐）。
 */
export function createClient(config: LlmConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    // 明确传入原生 fetch；本地教学端点 / 代理更稳。
    // SDK 的 Fetch 类型基于 node-fetch 声明，与 DOM fetch 签名略有出入，这里做一次类型断言。
    fetch: globalThis.fetch.bind(globalThis) as unknown as ClientOptions["fetch"],
  });
}

/** 把本地 ToolDefinition 转成 API 需要的 tools 数组 */
export function toApiTools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as Record<string, unknown>,
    },
  }));
}

/**
 * 把本地 Message[] 转成 SDK 参数
 * 学习点：我们维护的 Message 与 API 几乎同构，但仍需按 role 分支，
 * 因为 TypeScript 的 ChatCompletionMessageParam 是联合类型。
 */
export function toApiMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: m.tool_call_id!,
        content: m.content ?? "",
      };
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant" as const,
        content: m.content,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      };
    }
    if (m.role === "assistant") {
      return { role: "assistant" as const, content: m.content ?? "" };
    }
    if (m.role === "system") {
      return { role: "system" as const, content: m.content ?? "" };
    }
    return { role: "user" as const, content: m.content ?? "" };
  });
}

/**
 * 把 API 的 finish_reason 映射成我们的 StopReason
 * 学习点：只要真的拿到了 tool_calls，就按 tool_calls 处理——
 * 部分兼容端点在有工具调用时仍返回 finish_reason="stop"，以「实际内容」为准更稳。
 */
function toStopReason(finish: string | null | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls || finish === "tool_calls") return "tool_calls";
  if (finish === "length") return "length";
  // stop / null / content_filter / 其他非标准值：教学项目统一当最终文本处理
  return "stop";
}

/**
 * 统一入口：根据 config.stream 选择流式或非流式
 * 学习点：loop.ts 只调用这一个函数，两种模式对它完全透明。
 */
export async function chatOnce(
  client: OpenAI,
  config: LlmConfig,
  messages: Message[],
  tools: ToolDefinition[],
  hooks: StreamHooks = {},
): Promise<LlmResponse> {
  return config.stream
    ? chatStream(client, config, messages, tools, hooks)
    : chatNonStream(client, config, messages, tools);
}

/**
 * 非流式调用：一次请求拿到完整 message
 * 学习点：finish_reason === "tool_calls" 时，message 里会带 tool_calls；
 * Agent loop 必须先执行这些工具，再把结果以 role=tool 写回，才能继续对话。
 */
export async function chatNonStream(
  client: OpenAI,
  config: LlmConfig,
  messages: Message[],
  tools: ToolDefinition[],
): Promise<LlmResponse> {
  const response = await client.chat.completions.create({
    model: config.model,
    messages: toApiMessages(messages),
    tools: tools.length > 0 ? toApiTools(tools) : undefined,
    // 让模型自己决定何时用工具；也可设为 "required" 强制调用（教学时不推荐）
    tool_choice: tools.length > 0 ? "auto" : undefined,
  });

  const choice = response.choices[0];
  if (!choice) {
    return {
      message: { role: "assistant", content: "" },
      stopReason: "error",
    };
  }

  const raw = choice.message;
  const message: Message = {
    role: "assistant",
    content: raw.content ?? null,
  };

  if (raw.tool_calls && raw.tool_calls.length > 0) {
    message.tool_calls = raw.tool_calls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  return {
    message,
    stopReason: toStopReason(choice.finish_reason, Boolean(message.tool_calls?.length)),
  };
}

/** 流式拼接时每个工具调用的「槽位」 */
interface ToolCallSlot {
  id: string;
  name: string;
  arguments: string;
}

/**
 * 流式调用：stream: true，边收 chunk 边通过 hooks 通知上层
 *
 * 返回值与 chatNonStream 同构（完整的 assistant Message + stopReason），
 * 区别只在于「等待期间」上层能实时看到文本和工具调用的生成过程。
 */
export async function chatStream(
  client: OpenAI,
  config: LlmConfig,
  messages: Message[],
  tools: ToolDefinition[],
  hooks: StreamHooks = {},
): Promise<LlmResponse> {
  const stream = await client.chat.completions.create({
    model: config.model,
    messages: toApiMessages(messages),
    tools: tools.length > 0 ? toApiTools(tools) : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    stream: true,
  });

  /** 累积的助手文本 */
  let content = "";
  /** 以 index 为键的工具调用槽位（Map 保留插入顺序，但最后仍按 index 排序更稳） */
  const slots = new Map<number, ToolCallSlot>();
  /** 最后一个非空的 finish_reason */
  let finishReason: string | null = null;
  /** 是否收到过任何 choice（全程没有 choice 视为异常） */
  let sawChoice = false;

  // SDK 已把 SSE 的 "data: ..." 行解析为对象，并在 [DONE] 时结束迭代。
  // 个别端点 / 代理在发完最后一个 chunk 后直接关连接（不发 [DONE]），
  // 旧 HTTP 客户端会报 Premature close。若我们已经收到过 choice，就当作正常结束。
  try {
    for await (const chunk of stream) {
      // 有的端点会在末尾发一个只含 usage、choices 为空数组的 chunk，直接跳过
      const choice = chunk.choices[0];
      if (!choice) continue;
      sawChoice = true;

      const delta = choice.delta;

      // ---- 1) 文本增量：直接拼接并通知 UI ----
      if (delta?.content) {
        content += delta.content;
        hooks.onTextDelta?.(delta.content);
      }

      // ---- 2) 工具调用分片：按 index 归并 ----
      for (const piece of delta?.tool_calls ?? []) {
        // index 是分片归属的唯一依据；个别端点缺省时按 0 处理（只有单个调用）
        const index = piece.index ?? 0;
        let slot = slots.get(index);
        const isNew = !slot;
        if (!slot) {
          slot = { id: "", name: "", arguments: "" };
          slots.set(index, slot);
        }

        // id：通常只在首个分片出现；若重复出现也是同一个值，所以「赋值」而非「追加」
        if (piece.id) slot.id = piece.id;

        // name：OpenAI 只在首个分片给完整 name；但也有端点把 name 切碎或重复发送。
        // 策略：空则赋值；与已有值相同则忽略（重复发送）；否则视为碎片追加。
        const namePiece = piece.function?.name;
        const hadName = slot.name !== "";
        if (namePiece) {
          if (!hadName) slot.name = namePiece;
          else if (namePiece !== slot.name) slot.name += namePiece;
        }

        // arguments：JSON 字符串被切成任意长度的碎片，只能无脑按顺序追加
        const argsPiece = piece.function?.arguments;
        if (argsPiece) slot.arguments += argsPiece;

        if ((isNew || !hadName) && slot.name) {
          hooks.onToolCallStart?.(index, slot.name);
        }
        if (argsPiece) {
          hooks.onToolCallDelta?.(index, slot.name, slot.arguments.length);
        }
      }

      // ---- 3) 结束原因：通常只在最后一个有效 chunk 上出现 ----
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!sawChoice || !/premature close/i.test(msg)) throw err;
    // 已有数据：吞掉收尾异常，继续组装 LlmResponse
  }

  if (!sawChoice) {
    return { message: { role: "assistant", content: "" }, stopReason: "error" };
  }

  // 流读完：把槽位按 index 排序，组装成与非流式完全一致的 tool_calls
  const toolCalls: ToolCall[] = [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, s]) => s.name !== "")
    .map(([index, s]) => ({
      // 少数本地端点不给 id；我们补一个，保证后续 role=tool 能对上
      id: s.id || `call_${index}_${Date.now()}`,
      type: "function" as const,
      function: { name: s.name, arguments: s.arguments },
    }));

  const message: Message = {
    role: "assistant",
    // 与非流式保持一致：没有文本时用 null（OpenAI 在纯工具调用时也返回 null）
    content: content === "" ? null : content,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return { message, stopReason: toStopReason(finishReason, toolCalls.length > 0) };
}
