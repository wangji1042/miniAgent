/**
 * 对话流列表：渲染 user / assistant / tool 状态行
 * 学习点：TUI 只负责展示，不持有 LLM 客户端；数据由 App 状态驱动。
 */

import { Box, Text } from "ink";

export type UiMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "status"; text: string }
  | { id: string; kind: "tool"; name: string; phase: "start" | "end"; detail: string }
  | { id: string; kind: "error"; text: string };

interface Props {
  messages: UiMessage[];
}

export function MessageList({ messages }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map((m) => {
        if (m.kind === "user") {
          return (
            <Box key={m.id} marginBottom={1}>
              <Text color="cyan" bold>
                你:{" "}
              </Text>
              <Text>{m.text}</Text>
            </Box>
          );
        }
        if (m.kind === "assistant") {
          return (
            <Box key={m.id} marginBottom={1} flexDirection="column">
              <Text color="green" bold>
                Agent:
              </Text>
              <Text>{m.text || "(空响应)"}</Text>
            </Box>
          );
        }
        if (m.kind === "tool") {
          const color = m.phase === "start" ? "yellow" : "magenta";
          const label = m.phase === "start" ? "调用工具" : "工具结果";
          return (
            <Box key={m.id} marginBottom={0} flexDirection="column">
              <Text color={color} dimColor>
                [{label}] {m.name}
              </Text>
              <Text dimColor wrap="truncate-end">
                {m.detail.length > 200 ? m.detail.slice(0, 200) + "…" : m.detail}
              </Text>
            </Box>
          );
        }
        if (m.kind === "error") {
          return (
            <Box key={m.id}>
              <Text color="red">错误: {m.text}</Text>
            </Box>
          );
        }
        return (
          <Box key={m.id}>
            <Text dimColor>… {m.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
