/**
 * 流式回复区：显示「当前这一轮」正在生成的助手文本
 *
 * 学习点：
 * - 不直接写进消息列表，而是单独一块「草稿区」，避免每来一个字符就重建整条消息列表。
 * - llm_turn_end / done 时由 App 把最终文本归档到 MessageList，并清空本组件的 text。
 * - 光标用一个简单的 "▍" 暗示「还在打字」；非流式模式下 text 始终为空，本组件不渲染。
 */

import { Box, Text } from "ink";

interface Props {
  /** 已累积的增量文本 */
  text: string;
  /** true 时显示光标，表示模型仍在生成 */
  active: boolean;
  /** 工具参数生成进度（可选），例如「生成 write_file 参数中… 1234 字符」 */
  toolProgress?: string;
}

export function StreamingReply({ text, active, toolProgress }: Props) {
  if (!active && !text) return null;

  return (
    <Box marginBottom={1} flexDirection="column">
      <Text color="green" bold>
        Agent{active ? " ▍" : ":"}
      </Text>
      <Text>
        {text || (active ? "…" : "")}
        {active && text ? "▍" : ""}
      </Text>
      {toolProgress ? <Text color="yellow" dimColor>{toolProgress}</Text> : null}
    </Box>
  );
}
