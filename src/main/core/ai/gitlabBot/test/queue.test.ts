// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

const configState: { current: any } = { current: null };

vi.mock("../config/configStore", () => ({
  getGitlabBotConfig: () => configState.current,
}));

import { dedupeKey, GitlabEventQueue } from "../events/queue";
import type { GitlabEvent } from "../events/webhook";

const BASE_CONFIG = {
  enabled: true,
  port: 7799,
  relayToken: "",
  triggerWords: ["@qnote"],
  allowedProjects: [],
};

beforeEach(() => {
  configState.current = { ...BASE_CONFIG };
});

function makeEvent(overrides: Partial<GitlabEvent> = {}): GitlabEvent {
  return {
    eventType: "Note Hook",
    objectKind: "note",
    projectId: 7,
    projectPath: "team/app",
    labels: [],
    comment: "@qnote 修一下",
    noteId: 99,
    issueIid: 12,
    ...overrides,
  };
}

async function flush(ms = 5): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("事件去重键", () => {
  it("评论事件按 note id 去重", () => {
    expect(dedupeKey(makeEvent({ noteId: 99 }))).toBe("note:7:99");
  });

  it("issue 事件带上动作", () => {
    const event = makeEvent({
      objectKind: "issue",
      noteId: undefined,
      issueIid: 3,
      action: "open",
    });
    expect(dedupeKey(event)).toBe("issue:7:3:open");
  });

  it("issue 的 open 与 update 是两个键", () => {
    const open = makeEvent({
      objectKind: "issue",
      noteId: undefined,
      issueIid: 3,
      action: "open",
    });
    const update = makeEvent({
      objectKind: "issue",
      noteId: undefined,
      issueIid: 3,
      action: "update",
    });
    expect(dedupeKey(open)).toBe("issue:7:3:open");
    expect(dedupeKey(update)).toBe("issue:7:3:update");
  });

  it("合并请求事件按 iid 与动作去重", () => {
    const event = makeEvent({
      objectKind: "merge_request",
      noteId: undefined,
      issueIid: undefined,
      mrIid: 4,
      action: "open",
    });
    expect(dedupeKey(event)).toBe("mr:7:4:open");
  });
});

describe("事件队列", () => {
  it("命中触发词才消费", async () => {
    const consumed: string[] = [];
    const queue = new GitlabEventQueue(async (event) => {
      consumed.push(event.comment ?? "");
    });
    queue.enqueue(makeEvent({ comment: "随便看看" }));
    await flush();
    expect(consumed).toEqual([]);
  });

  it("消费时把指令传下去", async () => {
    const instructions: string[] = [];
    const queue = new GitlabEventQueue(async (_event, instruction) => {
      instructions.push(instruction);
    });
    queue.enqueue(makeEvent());
    await flush();
    expect(instructions).toEqual(["修一下"]);
  });

  it("同一个事件重复投递只入队一次", async () => {
    let count = 0;
    const queue = new GitlabEventQueue(async () => {
      count += 1;
    });
    const first = queue.enqueue(makeEvent());
    const second = queue.enqueue(makeEvent());
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.reason).toContain("重复");
    await flush();
    expect(count).toBe(1);
  });

  it("队列满了丢掉最旧的事件", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const consumed: number[] = [];
    const queue = new GitlabEventQueue(
      async (event) => {
        consumed.push(event.noteId ?? 0);
        await gate;
      },
      { capacity: 2 }
    );
    queue.enqueue(makeEvent({ noteId: 1 }));
    queue.enqueue(makeEvent({ noteId: 2 }));
    queue.enqueue(makeEvent({ noteId: 3 }));
    queue.enqueue(makeEvent({ noteId: 4 }));
    await flush();
    expect(queue.size).toBe(2);
    release();
    await flush(20);
    expect(consumed).toEqual([1, 3, 4]);
  });

  it("没触发的事件不占去重键，改完内容还能再触发", async () => {
    const consumed: string[] = [];
    const queue = new GitlabEventQueue(async (event) => {
      consumed.push(event.title ?? "");
    });
    const first = queue.enqueue(
      makeEvent({
        objectKind: "issue",
        noteId: undefined,
        issueIid: 3,
        comment: undefined,
        title: "登录白屏",
      })
    );
    await flush();
    expect(first.accepted).toBe(true);
    expect(consumed).toEqual([]);

    const second = queue.enqueue(
      makeEvent({
        objectKind: "issue",
        noteId: undefined,
        issueIid: 3,
        comment: undefined,
        title: "@qnote 登录白屏",
      })
    );
    await flush();
    expect(second.accepted).toBe(true);
    expect(consumed).toEqual(["@qnote 登录白屏"]);
  });

  it("去重历史按窗口滑动，不整段清空", async () => {
    const queue = new GitlabEventQueue(async () => {}, { doneLimit: 2 });
    queue.enqueue(makeEvent({ noteId: 1 }));
    await flush();
    queue.enqueue(makeEvent({ noteId: 2 }));
    await flush();
    queue.enqueue(makeEvent({ noteId: 3 }));
    await flush();
    expect(queue.enqueue(makeEvent({ noteId: 1 })).accepted).toBe(true);
    expect(queue.enqueue(makeEvent({ noteId: 2 })).accepted).toBe(false);
  });

  it("消费失败会重试", async () => {
    let attempts = 0;
    const queue = new GitlabEventQueue(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("boom");
      },
      { retryDelayMs: 1 }
    );
    queue.enqueue(makeEvent());
    await flush(60);
    expect(attempts).toBe(3);
  });

  it("重试用尽后放弃，不影响后续事件", async () => {
    let attempts = 0;
    const consumed: string[] = [];
    const queue = new GitlabEventQueue(
      async (event) => {
        attempts += 1;
        if (attempts <= 2) throw new Error("boom");
        consumed.push(event.comment ?? "");
      },
      { retryDelayMs: 1, maxRetries: 1 }
    );
    queue.enqueue(makeEvent({ noteId: 1 }));
    queue.enqueue(makeEvent({ noteId: 2 }));
    await flush(60);
    expect(consumed).toEqual(["@qnote 修一下"]);
  });
});
