// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  isTriggerPointer,
  parseTriggerPointer,
  TRIGGER_POINTER_TEMPLATE,
} from "../events/triggerPointer";

describe("trigger 指针模板", () => {
  it("是合法 JSON", () => {
    const parsed = JSON.parse(TRIGGER_POINTER_TEMPLATE);
    expect(parsed.object_kind).toBe("{{object_kind}}");
    expect(parsed.object_id).toBe("{{object_attributes.id}}");
  });

  it("占位符不带空格", () => {
    expect(TRIGGER_POINTER_TEMPLATE).not.toContain("{{ ");
    expect(TRIGGER_POINTER_TEMPLATE).not.toContain(" }}");
  });

  it("模板里只有 ASCII", () => {
    expect(/^[\x00-\x7F]*$/.test(TRIGGER_POINTER_TEMPLATE)).toBe(true);
  });
});

describe("指针判定", () => {
  it("标准 webhook 报文不是指针", () => {
    expect(
      isTriggerPointer({
        object_kind: "note",
        object_attributes: { note: "x" },
      })
    ).toBe(false);
  });

  it("带 object_id 的才是指针", () => {
    expect(isTriggerPointer({ object_kind: "note", object_id: "1" })).toBe(
      true
    );
  });

  it("空值与数组都不是指针", () => {
    expect(isTriggerPointer(null)).toBe(false);
    expect(isTriggerPointer("x")).toBe(false);
    expect(isTriggerPointer([{ object_id: "1" }])).toBe(false);
  });
});

describe("指针解析", () => {
  it("读出各项并把 null 当空", () => {
    const pointer = parseTriggerPointer({
      object_kind: "note",
      event_type: "note",
      project_id: "93599",
      project_path: "zhuyt9/demo",
      default_branch: "main",
      author: "zhuyt9",
      object_id: "9463460",
      object_iid: "null",
      noteable_type: "Issue",
      noteable_id: "47082",
      issue_iid: "3",
      mr_iid: "null",
    });
    expect(pointer).toEqual({
      kind: "note",
      eventType: "note",
      projectId: 93599,
      projectPath: "zhuyt9/demo",
      defaultBranch: "main",
      author: "zhuyt9",
      objectId: 9463460,
      objectIid: 0,
      noteableType: "Issue",
      noteableId: 47082,
      issueIid: 3,
      mrIid: 0,
    });
  });

  it("缺关键字段时不算指针", () => {
    expect(parseTriggerPointer({ object_id: "1" })).toBeNull();
  });
});
