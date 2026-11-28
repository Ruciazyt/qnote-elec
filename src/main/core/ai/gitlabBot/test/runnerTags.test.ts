// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  GITLAB_RUNNER_DEFAULT_TAGS,
  resolveRunnerTags,
} from "../../../../../shared/ai/gitlabBot";
import { buildCiTemplate } from "../../tools/gitlab/tools/runnerSetup";

describe("runner 标签", () => {
  it("空标签退回默认标签", () => {
    expect(resolveRunnerTags([])).toEqual(["qnote"]);
    expect(resolveRunnerTags(undefined)).toEqual(["qnote"]);
    expect(resolveRunnerTags(["  ", ""])).toEqual(["qnote"]);
  });

  it("给了标签就用给的，并去掉空白项", () => {
    expect(resolveRunnerTags(["qnote", "bot"])).toEqual(["qnote", "bot"]);
    expect(resolveRunnerTags([" qnote ", ""])).toEqual(["qnote"]);
  });

  it("默认值只有一份", () => {
    expect(GITLAB_RUNNER_DEFAULT_TAGS).toEqual(["qnote"]);
  });
});

describe("CI 模板与 runner 注册用同一份标签", () => {
  it("老配置读到空标签时，CI job 仍然要 qnote 标签", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "powershell",
      tags: resolveRunnerTags([]),
    });
    expect(yaml).toContain("    - qnote");
    expect(yaml).not.toContain("    - qnote-local");
  });

  it("给了标签时模板与解析结果一致", () => {
    const tags = resolveRunnerTags(["qnote", "bot"]);
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "powershell",
      tags,
    });
    for (const tag of tags) {
      expect(yaml).toContain("    - " + tag);
    }
  });
});
