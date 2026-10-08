# miniAgent

教学用**最简 TypeScript Agent（TUI）**。

不依赖 LangChain 等重型 Agent 框架，核心是一段可读的 **agent loop**：

`messages → LLM → tool_calls → 本地执行工具 → 写回 messages → 再调 LLM`，直到模型输出最终文本。

适合用来理解：Chat Completions、tool/function calling、`role=tool` 消息、以及终端里如何展示中间状态。

## 功能一览

- OpenAI **兼容** Chat Completions（可改 `baseURL` 指向 DeepSeek / 本地 vLLM / Ollama 等）
- 手写 Agent 循环（`src/agent/loop.ts`）
- 终端 TUI（ink + React）：对话流 + 工具调用状态
- 内置 4 个示例工具：
  - `get_current_time` — 当前时间
  - `calculator` — 安全四则运算（手写解析器，不用 `Function`/`eval`）
  - `read_file` — 读取项目目录内文件（防路径穿越）
  - `write_file` — 在项目目录内创建/覆盖文本文件（写代码）；防路径穿越，并拦截 `.env` / `node_modules` / `.git` / 密钥类路径

## 环境要求

- Node.js **≥ 18**（推荐 20+）
- npm 10+（随 Node 安装即可）

## 安装

在项目根目录执行：

```bash
npm install
```

## 配置环境变量

复制示例文件并编辑：

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

`.env` 中需要配置：

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | API Key；本地兼容服务可填任意非空字符串 |
| `OPENAI_BASE_URL` | 否 | 默认 `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 否 | 默认 `gpt-4o-mini`，按服务商改名 |

**不要把真实 Key 提交到 Git**（`.gitignore` 已忽略 `.env`）。

## 运行

```bash
npm run start
```

等价于 `npx tsx src/index.tsx`。

启动后在终端输入问题，例如：

- `现在几点？`
- `帮我算 (12.5 + 3) * 2`
- `读一下 README.md 的开头`
- `在 workspace/hello.ts 写一个问候函数`

内置斜杠命令：

| 命令 | 作用 |
|------|------|
| `/help` | 帮助 |
| `/clear` | 清空对话历史 |
| `/exit` 或 `/quit` | 退出 |
| `Ctrl+C` | 强制退出 |

## 类型检查

```bash
npm run typecheck
```

## 目录结构

```
miniAgent/
  package.json
  tsconfig.json
  .env.example
  .gitignore
  README.md
  ARCHITECTURE.md          # 架构与数据流（含 mermaid）
  src/
    index.tsx              # 入口：dotenv + 组装 + render TUI
    agent/
      loop.ts              # ★ Agent 主循环（最重要）
      types.ts             # Message / ToolCall 等类型
      llm.ts               # OpenAI 兼容客户端
      tools/
        index.ts           # ToolRegistry
        time.ts
        calculator.ts
        readFile.ts
        writeFile.ts
    tui/
      App.tsx
      components/
        MessageList.tsx
        InputBox.tsx
```

更细的运行原理见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 写文件安全边界（`write_file`）

| 规则 | 说明 |
|------|------|
| 仅相对路径 | 禁止绝对路径；必须落在项目 `cwd` 内 |
| 防穿越 | 与 `read_file` 相同的 `resolve` + `relative` 检查 |
| 敏感拦截 | 拒绝 `.env*`、`node_modules`、`.git`、常见密钥/证书文件名 |
| 大小限制 | 单次 `content` 最长约 10 万字符 |

## 学习路径建议

1. 先读 `src/agent/types.ts`，弄清四种 `role`
2. 再读 `src/agent/loop.ts` 的伪代码注释与 `for` 循环
3. 对照 `llm.ts` 看一次 API 请求如何组装
4. 打开 TUI，问一个会触发工具的问题，观察终端里的「调用工具 / 工具结果」行
5. 读 `ARCHITECTURE.md` 里的 mermaid 图，把整条数据流串起来

## License

MIT
