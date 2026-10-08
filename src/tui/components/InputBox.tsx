/**
 * 底部输入框
 * 学习点：busy 时禁用输入，避免用户在 agent loop 中途再塞一条消息打乱状态。
 */

import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface Props {
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}

export function InputBox({ value, busy, onChange, onSubmit }: Props) {
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {busy
          ? "Agent 运行中…（请等待）  |  Ctrl+C 退出"
          : "输入问题后回车  |  /help 帮助  |  /clear 清空  |  Ctrl+C 退出"}
      </Text>
      <Box>
        <Text color="cyan">{"> "}</Text>
        {busy ? (
          <Text dimColor>{value || "…"}</Text>
        ) : (
          <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
        )}
      </Box>
    </Box>
  );
}
