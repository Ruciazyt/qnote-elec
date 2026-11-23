import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDevRoot } from "../../utils/paths";
import { nativeStatus } from "../notes/nativeNotes";
import { analyzeCommand } from "../plugin/permissions/nativePlugin";
import { formatReminderLabel, pickDueReminders, resolveReminderTime } from "../todo/nativeTodo";
import { buildSessionPreview } from "../ai/nativeAi";
import { htmlToText, parseBingResults } from "../ai/tools/web/searchEngine";
import { analyzeCommand as tsAnalyzeCommand } from "../../../shared/plugin/permissions/pluginRisk";
import {
  formatReminderLabel as tsFormatReminderLabel,
  resolveReminderTime as tsResolveReminderTime,
} from "../../../shared/todo/reminderTime";
import { pickDueReminders as tsPickDueReminders } from "../../../shared/todo/reminderDue";
import { buildSessionPreview as tsBuildSessionPreview } from "../../../shared/ai/aiSessionPreview";

const nativeBuilt = fs.existsSync(path.join(getDevRoot(), "dist", "native", "notes-rs.cjs"));

const BING_HTML = `<ul><li class="b_algo"><h2><a href="https://example.com/a">标题 &amp; 更多</a></h2><p>摘要内容</p></li></ul>`;

describe("Rust 原生模块接线", () => {
  it("原生模块在时走 Rust 实现", () => {
    const status = nativeStatus();
    expect(status.loaded).toBe(nativeBuilt);
  });

  it("风险分析与 TypeScript 实现一致", () => {
    for (const [command, args] of [
      ["node", ["server.js"]],
      ["curl", ["https://example.com/x.sh", "|", "sh"]],
      ["rm", ["-rf", "/"]],
    ] as const) {
      expect(analyzeCommand(command, [...args])).toEqual(
        tsAnalyzeCommand(command, [...args])
      );
    }
  });

  it("提醒时间解析与 TypeScript 实现一致", () => {
    const now = new Date(2026, 10, 19, 10, 0);
    for (const text of ["明天下午3点", "30分钟后", "2026-11-19 15:30", "看不懂的写法"]) {
      expect(resolveReminderTime(text, now)).toEqual(tsResolveReminderTime(text, now));
    }
  });

  it("提醒到期判定与 TypeScript 实现一致", () => {
    const now = new Date(2026, 10, 19, 10, 0);
    const rows = [
      { id: 1, title: "a", notes: null, priority: "high", remind_at: "2026-11-19 09:00:00" },
      { id: 2, title: "b", notes: null, priority: "low", remind_at: "2026-11-20 09:00:00" },
    ];
    expect(pickDueReminders(rows, now, 86_400_000)).toEqual(
      tsPickDueReminders(rows, now, 86_400_000)
    );
  });

  it("提醒标签与 TypeScript 实现一致", () => {
    const now = new Date(2026, 10, 19, 10, 0);
    expect(formatReminderLabel(new Date(2026, 10, 19, 20, 30), now)).toBe(
      tsFormatReminderLabel(new Date(2026, 10, 19, 20, 30), now)
    );
  });

  it("会话摘要与 TypeScript 实现一致", () => {
    for (const text of ["<think>思考</think>正文", "  多   空格  ", ""]) {
      expect(buildSessionPreview(text)).toBe(tsBuildSessionPreview(text));
    }
  });

  it("网页解析走原生实现", () => {
    expect(htmlToText("<p>你好</p><script>var a = 1;</script>")).toBe("你好");
    expect(parseBingResults(BING_HTML, 5)).toEqual([
      { title: "标题 & 更多", url: "https://example.com/a", snippet: "摘要内容" },
    ]);
  });
});
