/**
 * 工具：read_file
 *
 * 学习点 / 安全：
 * - 永远不要让模型随便读绝对路径；必须限制在项目根（cwd）内。
 * - 用 path.resolve + 前缀检查防止 ../ 路径穿越。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../types.js";

/** 项目根目录：启动时的 process.cwd()（请在项目根运行 npm start） */
export function getProjectRoot(): string {
  return path.resolve(process.cwd());
}

/**
 * 把相对路径安全解析到项目根内；越界则抛错
 * 学习点：resolved === root 或 resolved.startsWith(root + sep) 才算合法。
 */
export function resolveSafePath(relativePath: string, root = getProjectRoot()): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("path 不能为空");
  }
  // 禁止绝对路径（Windows 盘符或 POSIX /）
  if (path.isAbsolute(relativePath)) {
    throw new Error("禁止绝对路径，请传入相对项目根的路径");
  }

  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  const rel = path.relative(normalizedRoot, resolved);

  // rel 以 .. 开头，或是绝对路径（跨盘），都视为穿越
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`路径越界：${relativePath} 不在项目目录内`);
  }
  return resolved;
}

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "读取项目目录内的文本文件（相对路径）。用于查看 README、源码等。禁止路径穿越。",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "相对项目根的路径，例如 README.md 或 src/agent/loop.ts",
      },
      maxChars: {
        type: "number",
        description: "最多返回的字符数，默认 4000，防止超大文件撑爆上下文",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(args) {
    const rel = String(args.path ?? "");
    const maxChars =
      typeof args.maxChars === "number" && args.maxChars > 0
        ? Math.min(args.maxChars, 20000)
        : 4000;

    try {
      const abs = resolveSafePath(rel);
      const content = await fs.readFile(abs, "utf8");
      const truncated = content.length > maxChars;
      const body = truncated ? content.slice(0, maxChars) : content;
      return JSON.stringify({
        path: rel,
        bytes: Buffer.byteLength(content, "utf8"),
        truncated,
        content: body,
      });
    } catch (err) {
      return `读取失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
