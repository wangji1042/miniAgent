/**
 * TUI 根组件
 *
 * 学习点：
 * - UI 状态（展示用 messages）与 Agent 历史（发给 LLM 的 Message[]）分开维护，
 *   但每次用户提交时，会把 user 文本同时写入两者。
 * - Agent loop 通过 onEvent 回调驱动 UI 更新，形成单向数据流。
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import type OpenAI from "openai";
import { defaultSystemPrompt, runAgentLoop } from "../agent/loop.js";
import type { LlmConfig, Message } from "../agent/types.js";
import type { ToolRegistry } from "../agent/tools/index.js";
import { InputBox } from "./components/InputBox.js";
import { MessageList, type UiMessage } from "./components/MessageList.js";

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
  const [uiMessages, setUiMessages] = useState<UiMessage[]>([
    {
      id: nextId(),
      kind: "status",
      text: `模型: ${config.model}  |  baseURL: ${config.baseURL}  |  工具: ${tools.listNames().join(", ")}`,
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
          text: "命令: /help | /clear | /exit。也可直接提问，例如「现在几点」「算 (1+2)*3」「读一下 README.md」「写一个 hello.ts」。",
        });
        return;
      }
      if (text === "/clear") {
        historyRef.current = [defaultSystemPrompt(tools.listNames())];
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
      try {
        await runAgentLoop({
          client,
          config,
          messages: historyRef.current,
          tools,
          onEvent: (event) => {
            if (event.type === "status") {
              appendUi({ id: nextId(), kind: "status", text: event.text });
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
              appendUi({ id: nextId(), kind: "assistant", text: event.finalText });
            }
          },
        });
      } catch (err) {
        appendUi({
          id: nextId(),
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    },
    [appendUi, busy, client, config, exit, tools],
  );

  const header = useMemo(
    () => (
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="green">
          miniAgent — 教学用最简 TypeScript Agent（TUI）
        </Text>
        <Text dimColor>手写 agent loop · OpenAI 兼容 · ink 终端界面</Text>
      </Box>
    ),
    [],
  );

  return (
    <Box flexDirection="column" padding={1}>
      {header}
      <MessageList messages={uiMessages} />
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
