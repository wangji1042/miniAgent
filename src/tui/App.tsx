/**
 * TUI 根组件
 *
 * 学习点：
 * - UI 状态（展示用 messages）与 Agent 历史（发给 LLM 的 Message[]）分开维护，
 *   但每次用户提交时，会把 user 文本同时写入两者。
 * - Agent loop 通过 onEvent 回调驱动 UI 更新，形成单向数据流。
 * - 流式输出：text_delta → 更新 streamingText；llm_turn_end → 归档到消息列表。
 *   纯工具调用轮次（没有文本）不会产生多余的空助手气泡。
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import type OpenAI from "openai";
import { defaultSystemPrompt, runAgentLoop } from "../agent/loop.js";
import type { LlmConfig, Message } from "../agent/types.js";
import type { ToolRegistry } from "../agent/tools/index.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList, type UiMessage } from "./components/MessageList.js";
import { StreamingReply } from "./components/StreamingReply.js";

interface Props {
  client: OpenAI;
  config: LlmConfig;
  tools: ToolRegistry;
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return String(idSeq);
}

export function App({ client, config, tools }: Props) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** 当前流式轮次累积的文本；归档后清空 */
  const [streamingText, setStreamingText] = useState("");
  /** 是否正处于「等待 / 接收 LLM 输出」阶段（用于显示光标） */
  const [streamingActive, setStreamingActive] = useState(false);
  /** 工具参数生成进度提示（如「write_file 参数 1234 字符」），流式下才有 */
  const [toolProgress, setToolProgress] = useState("");
  /**
   * streamingText 的同步镜像。
   * 学习点：setState 是异步的，catch 分支里读 state 可能拿到旧值；
   * 用 ref 同步记录，才能在流中途出错时把「已收到的半截文本」归档。
   */
  const streamingRef = useRef("");

  /** 清空草稿区（state 与 ref 一起清） */
  const resetDraft = useCallback(() => {
    streamingRef.current = "";
    setStreamingText("");
    setToolProgress("");
  }, []);

  const [uiMessages, setUiMessages] = useState<UiMessage[]>([
    {
      id: nextId(),
      kind: "status",
      text: `模型: ${config.model}  |  baseURL: ${config.baseURL}  |  stream: ${config.stream ? "on" : "off"}  |  工具: ${tools.listNames().join(", ")}`,
    },
  ]);

  // Agent 侧的权威历史（含 system / tool 等完整协议消息）
  const historyRef = useRef<Message[]>([
    defaultSystemPrompt(tools.listNames()),
  ]);

  const appendUi = useCallback((msg: UiMessage) => {
    setUiMessages((prev) => [...prev, msg]);
  }, []);

  const handleSubmit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput("");

      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }
      if (text === "/help") {
        appendUi({
          id: nextId(),
          kind: "status",
          text: "命令: /help | /clear | /exit。也可直接提问，例如「现在几点」「算 (1+2)*3」「读一下 README.md」「写一个 hello.ts」。流式可用 OPENAI_STREAM=false 关闭。",
        });
        return;
      }
      if (text === "/clear") {
        historyRef.current = [defaultSystemPrompt(tools.listNames())];
        resetDraft();
        setStreamingActive(false);
        setUiMessages([
          {
            id: nextId(),
            kind: "status",
            text: "已清空对话历史。",
          },
        ]);
        return;
      }

      appendUi({ id: nextId(), kind: "user", text });
      historyRef.current.push({ role: "user", content: text });

      setBusy(true);
      resetDraft();
      setStreamingActive(true);
      try {
        await runAgentLoop({
          client,
          config,
          messages: historyRef.current,
          tools,
          onEvent: (event) => {
            if (event.type === "status") {
              // 新一轮 LLM 调用开始：清空草稿区，准备接收下一批 delta
              resetDraft();
              setStreamingActive(true);
              appendUi({ id: nextId(), kind: "status", text: event.text });
            } else if (event.type === "text_delta") {
              // 核心：增量追加 → React 重渲染 → 逐字显示
              streamingRef.current += event.text;
              setStreamingText(streamingRef.current);
            } else if (event.type === "tool_call_start") {
              appendUi({
                id: nextId(),
                kind: "status",
                text: `模型正在生成工具调用：${event.name}`,
              });
            } else if (event.type === "tool_call_delta") {
              // 参数可能很长（如 write_file 的整份代码）：只在草稿区刷新进度，不刷屏
              setToolProgress(`生成 ${event.name} 参数中… ${event.argsLength} 字符`);
            } else if (event.type === "llm_turn_end") {
              // 本轮流结束：草稿区收起
              setStreamingActive(false);
              resetDraft();
              // 归档规则：
              // - 带工具调用的中间轮次：若模型顺便说了话（如「我先查一下时间」），归档该文本；
              // - 最终文本轮次：不在这里归档，交给紧随其后的 done 事件，避免同一段话出现两次。
              if (event.hasToolCalls && event.content) {
                appendUi({ id: nextId(), kind: "assistant", text: event.content });
              }
            } else if (event.type === "tool_start") {
              appendUi({
                id: nextId(),
                kind: "tool",
                name: event.name,
                phase: "start",
                detail: event.args,
              });
            } else if (event.type === "tool_end") {
              appendUi({
                id: nextId(),
                kind: "tool",
                name: event.name,
                phase: "end",
                detail: event.result,
              });
            } else if (event.type === "error") {
              appendUi({ id: nextId(), kind: "error", text: event.text });
            } else if (event.type === "done") {
              setStreamingActive(false);
              resetDraft();
              appendUi({ id: nextId(), kind: "assistant", text: event.finalText });
            }
          },
        });
      } catch (err) {
        // 流中途断开（网络、端点报错）：把已收到的半截文本保留下来，方便排查
        if (streamingRef.current) {
          appendUi({
            id: nextId(),
            kind: "assistant",
            text: `${streamingRef.current}\n（流已中断）`,
          });
        }
        resetDraft();
        appendUi({
          id: nextId(),
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
        setStreamingActive(false);
      }
    },
    [appendUi, busy, client, config, exit, resetDraft, tools],
  );

  const header = useMemo(
    () => (
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="green">
          miniAgent — 教学用最简 TypeScript Agent（TUI）
        </Text>
        <Text dimColor>
          手写 agent loop · OpenAI 兼容 · ink 终端界面 · 流式
          {config.stream ? "开" : "关"}
        </Text>
      </Box>
    ),
    [config.stream],
  );

  return (
    <Box flexDirection="column" padding={1}>
      {header}
      <MessageList messages={uiMessages} />
      <StreamingReply text={streamingText} active={streamingActive} toolProgress={toolProgress} />
      <InputBox
        value={input}
        busy={busy}
        onChange={setInput}
        onSubmit={(v) => {
          void handleSubmit(v);
        }}
      />
    </Box>
  );
}
