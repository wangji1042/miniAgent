/**
 * 工具：write_file
 *
 * 学习点 / 安全：
 * - 「能写代码」不等于「能写任意路径」。与 read_file 一样，必须锁在项目 cwd 内。
 * - 额外拦截敏感/危险路径（.env、node_modules、.git 等），避免 Agent 误删密钥或污染依赖树。
 * - 覆盖已存在文件前在返回值里标明 overwritten，方便人在 TUI 里察觉副作用。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../types.js";
import { resolveSafePath } from "./readFile.js";

/** 单次写入的字符上限，防止一次 tool call 把上下文/磁盘撑爆 */
const MAX_CONTENT_CHARS = 100_000;

/**
 * 相对路径（posix 风格）是否落在禁止写入的区域
 * 学习点：既检查「整段路径名」，也检查「路径分段」，才能挡住 node_modules/foo 与 foo/.env。
 */
export function isBlockedWritePath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const lower = normalized.toLowerCase();
  const segments = lower.split("/").filter(Boolean);

  // 精确或前缀命中的敏感文件/目录名
  const blockedNames = new Set([
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    "node_modules",
    ".git",
    ".ssh",
    "credentials",
    "credentials.json",
    "secrets",
    "secrets.json",
  ]);

  // 任意分段命中即拒绝（例如 src/../.env 已被 resolveSafePath 挡掉；这里挡 node_modules/x）
  for (const seg of segments) {
    if (blockedNames.has(seg)) {
      return `禁止写入敏感路径分段：${seg}`;
    }
    // .env.* 变体（如 .env.staging）
    if (seg === ".env" || seg.startsWith(".env.")) {
      return `禁止写入环境变量文件：${seg}`;
    }
  }

  // 私钥 / 证书类扩展名
  const base = segments[segments.length - 1] ?? "";
  if (
    base.endsWith(".pem") ||
    base.endsWith(".key") ||
    base === "id_rsa" ||
    base === "id_ed25519" ||
    base.endsWith(".p12") ||
    base.endsWith(".pfx")
  ) {
    return `禁止写入密钥/证书类文件：${base}`;
  }

  return null;
}

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "在项目目录内创建或覆盖文本文件（相对路径），用于写入/修改代码与文档。" +
    "禁止路径穿越，禁止写入 .env、node_modules、.git 及密钥类文件。",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "相对项目根的路径，例如 src/demo.ts 或 notes/hello.md",
      },
      content: {
        type: "string",
        description: "要写入的完整文本内容（UTF-8）",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(args) {
    const rel = String(args.path ?? "");
    const content = args.content == null ? "" : String(args.content);

    if (!rel.trim()) {
      return "写入失败：path 不能为空";
    }
    if (content.length > MAX_CONTENT_CHARS) {
      return `写入失败：content 过长（${content.length} > ${MAX_CONTENT_CHARS} 字符）`;
    }

    const blocked = isBlockedWritePath(rel);
    if (blocked) {
      return `写入失败：${blocked}`;
    }

    try {
      const abs = resolveSafePath(rel);

      // 再次用解析后的相对路径检查（防止奇怪的 ./ 组合漏网）
      const rootRel = path.relative(path.resolve(process.cwd()), abs);
      const blockedAfter = isBlockedWritePath(rootRel);
      if (blockedAfter) {
        return `写入失败：${blockedAfter}`;
      }

      let overwritten = false;
      try {
        await fs.access(abs);
        overwritten = true;
      } catch {
        overwritten = false;
      }

      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");

      return JSON.stringify({
        path: rel,
        bytes: Buffer.byteLength(content, "utf8"),
        overwritten,
        created: !overwritten,
      });
    } catch (err) {
      return `写入失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
