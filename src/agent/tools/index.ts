/**
 * ToolRegistry：工具注册表
 *
 * 学习点：
 * - Agent 不直接 import 每个工具去跑，而是「按名字查找」。
 * - list() 给 LLM 看说明书；get(name) 在 loop 里分发执行。
 */

import type { ToolDefinition } from "../types.js";
import { calculatorTool } from "./calculator.js";
import { readFileTool } from "./readFile.js";
import { getCurrentTimeTool } from "./time.js";
import { writeFileTool } from "./writeFile.js";

export class ToolRegistry {
  private readonly map = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.map.has(tool.name)) {
      throw new Error(`工具重名：${tool.name}`);
    }
    this.map.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.map.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.map.values()];
  }

  listNames(): string[] {
    return [...this.map.keys()];
  }
}

/** 创建内置教学工具集 */
export function createDefaultTools(): ToolRegistry {
  return new ToolRegistry()
    .register(getCurrentTimeTool)
    .register(calculatorTool)
    .register(readFileTool)
    .register(writeFileTool);
}

export { calculatorTool, getCurrentTimeTool, readFileTool, writeFileTool };
