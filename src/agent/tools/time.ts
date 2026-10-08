/**
 * 工具：get_current_time
 * 学习点：最简单的「零参数 / 少参数」工具，用来验证 tool calling 整条链路是否通。
 */

import type { ToolDefinition } from "../types.js";

export const getCurrentTimeTool: ToolDefinition = {
  name: "get_current_time",
  description: "获取当前日期和时间。可选时区，默认 Asia/Shanghai。",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA 时区名，例如 Asia/Shanghai、UTC、America/New_York",
      },
    },
    additionalProperties: false,
  },
  execute(args) {
    const timezone =
      typeof args.timezone === "string" && args.timezone.trim()
        ? args.timezone.trim()
        : "Asia/Shanghai";
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);
      return JSON.stringify({ timezone, iso: now.toISOString(), local: formatted });
    } catch {
      return `错误：无效时区 "${timezone}"`;
    }
  },
};
