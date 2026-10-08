/**
 * 程序入口
 *
 * 学习点：
 * 1. 先加载 .env，再创建 LLM 客户端与工具注册表；
 * 2. 用 ink 的 render() 挂载 React TUI；
 * 3. 业务逻辑（agent loop）与展示（App）分层，入口只做组装。
 */

import { render, Text } from "ink";
import { config as loadEnv } from "dotenv";
import { createClient, loadLlmConfig } from "./agent/llm.js";
import { createDefaultTools } from "./agent/tools/index.js";
import { App } from "./tui/App.js";

// 从项目根目录的 .env 读取 OPENAI_*（不会提交真实 key）
loadEnv();

function main() {
  try {
    const config = loadLlmConfig();
    const client = createClient(config);
    const tools = createDefaultTools();

    render(<App client={client} config={config} tools={tools} />);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 配置错误时也用 ink 打一行，保持体验一致
    render(
      <Text color="red">
        启动失败：{message}
        {"\n"}请复制 .env.example 为 .env 并填写 OPENAI_API_KEY 等变量。
      </Text>,
    );
    process.exitCode = 1;
  }
}

main();
