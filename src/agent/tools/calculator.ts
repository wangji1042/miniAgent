/**
 * 工具：calculator
 *
 * 学习点 / 安全：
 * - 不要用 new Function() 或裸 eval 执行模型传来的字符串（注入风险）。
 * - 这里用手写的递归下降解析器，只允许数字与 + - * / ( ) 和一元正负号。
 */

import type { ToolDefinition } from "../types.js";

/** 安全计算四则表达式；非法字符直接拒绝 */
export function safeEvaluate(expression: string): number {
  const src = expression.replace(/\s+/g, "");
  if (!src) throw new Error("空表达式");
  if (!/^[0-9.+\-*/()]+$/.test(src)) {
    throw new Error("只允许数字和 + - * / ( )");
  }

  let i = 0;

  function peek(): string {
    return src[i] ?? "";
  }
  function consume(): string {
    return src[i++] ?? "";
  }

  // expr = term (("+" | "-") term)*
  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  // term = unary (("*" | "/") unary)*
  function parseTerm(): number {
    let value = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseUnary();
      if (op === "/") {
        if (right === 0) throw new Error("除以零");
        value = value / right;
      } else {
        value = value * right;
      }
    }
    return value;
  }

  // unary = ("+" | "-") unary | primary
  function parseUnary(): number {
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    if (peek() === "-") {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  }

  // primary = number | "(" expr ")"
  function parsePrimary(): number {
    if (peek() === "(") {
      consume();
      const value = parseExpr();
      if (peek() !== ")") throw new Error("缺少右括号");
      consume();
      return value;
    }
    return parseNumber();
  }

  function parseNumber(): number {
    const start = i;
    while (/[0-9]/.test(peek())) consume();
    if (peek() === ".") {
      consume();
      if (!/[0-9]/.test(peek())) throw new Error("小数点后缺少数字");
      while (/[0-9]/.test(peek())) consume();
    }
    if (start === i) throw new Error(`期望数字，却遇到 '${peek() || "EOF"}'`);
    const n = Number(src.slice(start, i));
    if (!Number.isFinite(n)) throw new Error("数字无效");
    return n;
  }

  const result = parseExpr();
  if (i !== src.length) {
    throw new Error(`表达式未解析完，残留：${src.slice(i)}`);
  }
  return result;
}

export const calculatorTool: ToolDefinition = {
  name: "calculator",
  description: "计算简单四则运算表达式（支持 + - * / 与括号）。例如：'(1+2)*3.5'",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "算术表达式，仅含数字与 + - * / ( )",
      },
    },
    required: ["expression"],
    additionalProperties: false,
  },
  execute(args) {
    const expression = String(args.expression ?? "");
    try {
      const value = safeEvaluate(expression);
      return JSON.stringify({ expression, value });
    } catch (err) {
      return `计算失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
