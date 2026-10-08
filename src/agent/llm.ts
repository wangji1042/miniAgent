/**
 * OpenAI 兼容 Chat Completions 客户端
 *
 * 学习点：
 * - 官方 openai SDK 通过 baseURL 即可指向任意兼容端点（DeepSeek、本地 vLLM、Ollama 等）。
 * - 本文件只负责「发一次请求、把响应规范化」；多轮循环在 loop.ts。
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { LlmConfig, LlmResponse, Message, ToolDefinition } from "./types.js";

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
  };
}

/** 创建 SDK 客户端（可复用） */
export function createClient(config: LlmConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
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
 * 调用一次 Chat Completions
 * 学习点：finish_reason === "tool_calls" 时，message 里会带 tool_calls；
 * Agent loop 必须先执行这些工具，再把结果以 role=tool 写回，才能继续对话。
 */
export async function chatOnce(
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

  const finish = choice.finish_reason;
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

  let stopReason: LlmResponse["stopReason"];
  if (finish === "tool_calls" || (message.tool_calls && message.tool_calls.length > 0)) {
    stopReason = "tool_calls";
  } else if (finish === "length") {
    stopReason = "length";
  } else if (finish === "stop" || finish == null) {
    stopReason = "stop";
  } else {
    // content_filter / function_call 等：教学项目统一当最终文本处理
    // 部分兼容端点也可能返回非标准 finish_reason
    stopReason = "stop";
  }

  return { message, stopReason };
}
