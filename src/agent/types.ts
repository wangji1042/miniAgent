/**
 * Agent 核心类型定义
 *
 * 学习点：
 * - 这些类型刻意贴近 OpenAI Chat Completions API 的消息形状，
 *   这样「本地 messages 数组」和「发给 LLM 的 JSON」几乎一一对应，方便对照文档学习。
 * - Agent 的全部状态本质上就是一条不断增长的 messages 列表。
 */

/** 消息角色：对应 Chat Completions 的 role 字段 */
export type Role = "system" | "user" | "assistant" | "tool";

/**
 * 工具调用（模型决定「要调用哪个工具、传什么参数」）
 * 学习点：tool_calls 出现在 assistant 消息里；真正执行结果用 role=tool 的消息写回。
 */
export interface ToolCall {
  /** 本次调用的唯一 id，后续 tool 消息必须带同一个 id 才能对上 */
  id: string;
  /** 固定为 function（OpenAI 兼容协议约定） */
  type: "function";
  function: {
    /** 工具名，必须与注册表里的 name 一致 */
    name: string;
    /** 参数 JSON 字符串（注意：是字符串，不是对象；执行前需要 JSON.parse） */
    arguments: string;
  };
}

/**
 * 对话中的一条消息
 * 学习点：四种 role 各司其职——
 * - system：行为约束 / 人设
 * - user：人类输入
 * - assistant：模型输出（纯文本，或带 tool_calls）
 * - tool：某个 tool_call 的执行结果
 */
export interface Message {
  role: Role;
  content: string | null;
  /** 仅 assistant 在请求工具时出现 */
  tool_calls?: ToolCall[];
  /** 仅 role=tool 时需要，指向对应的 ToolCall.id */
  tool_call_id?: string;
  /** 仅 role=tool 时可选，方便调试 */
  name?: string;
}

/** 工具的 JSON Schema 参数描述（给模型看的「说明书」） */
export interface ToolParametersSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
    }
  >;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * 可注册工具的统一接口
 * 学习点：把「给模型看的定义」和「本地真正执行的函数」绑在一起，
 * 注册表才能同时完成：1) 生成 tools 数组发给 LLM；2) 按 name 分发执行。
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  /** 执行体：接收已解析的参数对象，返回字符串结果（会写进 tool 消息的 content） */
  execute: (args: Record<string, unknown>) => Promise<string> | string;
}

/** OpenAI 兼容 API 配置（从环境变量读取） */
export interface LlmConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * Agent 单步结束后的「停止原因」
 * 学习点：对照 OpenAI finish_reason——
 * - stop：模型认为说完了，输出最终文本
 * - tool_calls：模型要求先跑工具，再继续
 * - length：被 max_tokens 截断（本教学项目会当作错误处理）
 */
export type StopReason = "stop" | "tool_calls" | "length" | "error";

/** 单次 LLM 调用的规范化结果（屏蔽 SDK 细节，方便 loop 使用） */
export interface LlmResponse {
  message: Message;
  stopReason: StopReason;
}

/** 供 TUI 展示的事件（loop 通过回调推送，UI 只消费，不直接碰 LLM） */
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "assistant_delta"; text: string }
  | { type: "tool_start"; name: string; args: string; id: string }
  | { type: "tool_end"; name: string; result: string; id: string }
  | { type: "error"; text: string }
  | { type: "done"; finalText: string };
