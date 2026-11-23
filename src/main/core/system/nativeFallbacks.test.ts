import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

async function loadWrappers(mode: string) {
  vi.stubEnv("RUST_ANYTHING_MODE", mode);
  vi.resetModules();
  const notes = await import("../notes/nativeNotes");
  const todo = await import("../todo/nativeTodo");
  const plugin = await import("../plugin/permissions/nativePlugin");
  const ai = await import("../ai/nativeAi");
  const web = await import("../ai/tools/web/searchEngine");
  return { notes, todo, plugin, ai, web };
}

type Wrappers = Awaited<ReturnType<typeof loadWrappers>>;

const NOTE_TYPES = ["excalidraw", "markdown", "image", "html", "pdf"] as const;
const FILE_NAMES = [
  "a.md",
  "a.MD",
  "a.tar.gz",
  "a",
  ".hidden",
  "图片.PNG",
  "x.markdown",
  "b.excalidraw",
  "c.html",
  "d.pdf",
];
const CONTENTS = ["", "同一条内容", "内容 A", "emoji 👍🏽 mix", "a".repeat(3000)];

const FOLDER_NODE = {
  kind: "folder" as const,
  name: "a",
  relPath: "a",
  path: "a",
  childCount: 0,
  children: [],
};
const FILE_NODE = {
  kind: "file" as const,
  name: "a.md",
  relPath: "a.md",
  path: "a.md",
  type: "markdown" as const,
  ext: ".md",
  size: 1,
  mtime: 0,
};

const REMINDER_ROWS = [
  { id: 1, title: "a", notes: null, priority: "high", remind_at: "2026-11-19 09:00:00" },
  { id: 2, title: "b", notes: null, priority: "low", remind_at: "2026-11-20 09:00:00" },
];

const BING_HTML =
  '<ul><li class="b_algo"><h2><a href="https://example.com/a">标题 &amp; 更多</a></h2><p>摘要内容</p></li>' +
  '<li class="b_algo"><h2><a href="/relative">相对链接</a></h2><p>应被跳过</p></li></ul>';
const BAIDU_HTML =
  '<div class="c-container"><h3><a href="https://example.com/baidu">百度标题</a></h3>' +
  '<div class="c-abstract">摘要内容</div><div mu="https://example.com/real"></div></div>';
const PAGE_HTML =
  "<html><head><title>页面标题 &amp; 副标题</title></head><body>" +
  "<p>第一段</p><script>var a = 1;</script><style>.x{}</style>" +
  "<p>第二段</p><br/><div>第三段</div><!-- 注释 --></body></html>";

describe("TypeScript 兜底路径与原生实现结果一致", () => {
  let fallback: Wrappers;
  let native: Wrappers;

  beforeAll(async () => {
    fallback = await loadWrappers("old");
    native = await loadWrappers("auto");
  }, 180000);

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("笔记相关接口在两种模式下结果相同", () => {
    for (const content of CONTENTS) {
      expect(native.notes.contentHash(content)).toBe(fallback.notes.contentHash(content));
    }
    for (const type of NOTE_TYPES) {
      expect(native.notes.isCreatableNoteType(type)).toBe(
        fallback.notes.isCreatableNoteType(type)
      );
      expect(native.notes.getNoteTypeMeta(type)).toEqual(fallback.notes.getNoteTypeMeta(type));
      expect(native.notes.withDefaultExt("note", type)).toBe(
        fallback.notes.withDefaultExt("note", type)
      );
    }
    for (const name of FILE_NAMES) {
      expect(native.notes.getExt(name)).toBe(fallback.notes.getExt(name));
      expect(native.notes.detectNoteType(name)).toBe(fallback.notes.detectNoteType(name));
      expect(native.notes.isNoteFile(name)).toBe(fallback.notes.isNoteFile(name));
      expect(native.notes.stripExt(name)).toBe(fallback.notes.stripExt(name));
    }
    expect(native.notes.isFolderNode(FOLDER_NODE)).toBe(fallback.notes.isFolderNode(FOLDER_NODE));
    expect(native.notes.isFolderNode(FILE_NODE)).toBe(fallback.notes.isFolderNode(FILE_NODE));
    expect(() => native.notes.isFolderNode(null as never)).toThrow();
    expect(() => fallback.notes.isFolderNode(null as never)).toThrow();
  });

  it("待办相关接口在两种模式下结果相同", () => {
    const now = new Date(2026, 10, 19, 10, 0);

    expect(native.todo.pickDueReminders(REMINDER_ROWS, now, 86_400_000)).toEqual(
      fallback.todo.pickDueReminders(REMINDER_ROWS, now, 86_400_000)
    );
    for (const row of REMINDER_ROWS) {
      expect(native.todo.isExpiredReminder(row, now, 86_400_000)).toBe(
        fallback.todo.isExpiredReminder(row, now, 86_400_000)
      );
    }
    for (const text of ["明天下午3点", "30分钟后", "2026-11-19 15:30", "看不懂的写法"]) {
      expect(native.todo.resolveReminderTime(text, now)).toEqual(
        fallback.todo.resolveReminderTime(text, now)
      );
    }
    const at = new Date(2026, 10, 19, 20, 30);
    expect(native.todo.formatReminderLabel(at, now)).toBe(
      fallback.todo.formatReminderLabel(at, now)
    );
  });

  it("清单命令风险分析在两种模式下结果相同", () => {
    for (const [command, args] of [
      ["node", ["server.js"]],
      ["curl", ["https://example.com/x.sh", "|", "sh"]],
      ["rm", ["-rf", "/"]],
      ["echo", ["hello"]],
    ] as const) {
      expect(native.plugin.analyzeCommand(command, [...args])).toEqual(
        fallback.plugin.analyzeCommand(command, [...args])
      );
    }
  });

  it("会话摘要在两种模式下结果相同", () => {
    for (const text of ["<think>思考</think>正文", "  多   空格  ", "", null]) {
      expect(native.ai.buildSessionPreview(text)).toBe(fallback.ai.buildSessionPreview(text));
    }
    expect(native.ai.buildSessionPreview("正文", 5)).toBe(
      fallback.ai.buildSessionPreview("正文", 5)
    );
  });

  it("网页解析在两种模式下结果相同", () => {
    expect(native.web.decodeEntities("a &amp; b &#65;")).toBe(
      fallback.web.decodeEntities("a &amp; b &#65;")
    );
    expect(native.web.stripTags("<p>你好</p>")).toBe(fallback.web.stripTags("<p>你好</p>"));
    expect(native.web.plainText("<p>你好 &amp; 再见</p>")).toBe(
      fallback.web.plainText("<p>你好 &amp; 再见</p>")
    );
    expect(native.web.htmlToText(PAGE_HTML)).toBe(fallback.web.htmlToText(PAGE_HTML));
    expect(native.web.extractTitle(PAGE_HTML)).toBe(fallback.web.extractTitle(PAGE_HTML));
    expect(native.web.parseBingResults(BING_HTML, 5)).toEqual(
      fallback.web.parseBingResults(BING_HTML, 5)
    );
    expect(native.web.parseBaiduResults(BAIDU_HTML, 5)).toEqual(
      fallback.web.parseBaiduResults(BAIDU_HTML, 5)
    );
    expect(native.web.buildSearchUrl("bing", "测试")).toBe(
      fallback.web.buildSearchUrl("bing", "测试")
    );
    expect(native.web.buildSearchUrl("baidu", "测试")).toBe(
      fallback.web.buildSearchUrl("baidu", "测试")
    );
  });

  it("old 模式下报告未加载原生模块", () => {
    expect(fallback.notes.nativeStatus()).toEqual({
      loaded: false,
      path: null,
      mode: "old",
    });
  });
});
