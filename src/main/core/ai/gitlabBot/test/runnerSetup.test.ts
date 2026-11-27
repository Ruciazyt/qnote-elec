// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildCiTemplate,
  buildTriggerApiUrl,
} from "../../tools/gitlab/tools/runnerSetup";

describe("trigger API 地址", () => {
  it("按数字项目 ID 与分支拼出触发地址", () => {
    const url = buildTriggerApiUrl({
      baseUrl: "https://gitlab.example.com/",
      projectId: 93599,
      ref: "main",
      token: "glptt-abc",
    });
    expect(url).toBe(
      "https://gitlab.example.com/api/v4/projects/93599/ref/main/trigger/pipeline?token=glptt-abc"
    );
  });

  it("分支里的斜杠会被编码", () => {
    const url = buildTriggerApiUrl({
      baseUrl: "https://gitlab.example.com",
      projectId: 12,
      ref: "feature/x",
      token: "t",
    });
    expect(url).toContain("/ref/feature%2Fx/trigger/pipeline");
  });

  it("令牌里的特殊字符会被编码", () => {
    const url = buildTriggerApiUrl({
      baseUrl: "https://gitlab.example.com",
      projectId: 12,
      ref: "main",
      token: "a b&c",
    });
    expect(url).toContain("token=a%20b%26c");
  });
});

describe("CI 模板", () => {
  it("PowerShell 版本带令牌头与 pipeline id 转发", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "powershell",
    });
    expect(yaml).toContain("curl.exe");
    expect(yaml).toContain("X-QNote-Relay-Token: $env:QNOTE_RELAY_TOKEN");
    expect(yaml).toContain("X-QNote-Pipeline-Id: $env:CI_PIPELINE_ID");
    expect(yaml).toContain("X-QNote-Project-Id: $env:CI_PROJECT_ID");
    expect(yaml).toContain("$env:QNOTE_RELAY_URL");
    expect(yaml).toContain('$CI_PIPELINE_SOURCE == "trigger" && $TRIGGER_PAYLOAD');
  });

  it("指针文件交给 curl 直接发，不把内容读进变量", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "powershell",
    });
    const script = yaml
      .split("\n")
      .filter((line) => line.includes("curl"))
      .join("\n");
    expect(script).toContain('--data-binary "@$env:TRIGGER_PAYLOAD"');
    expect(script).not.toContain("Get-Content");
    expect(script).not.toContain("Out-File");
  });

  it("bash 版本同样把指针文件交给 curl", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "bash",
    });
    const script = yaml
      .split("\n")
      .filter((line) => line.includes("curl"))
      .join("\n");
    expect(script).toContain('--data-binary "@$TRIGGER_PAYLOAD"');
    expect(script).not.toContain("$(cat ");
  });

  it("bash 版本用 curl 带 pipeline id 转发", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "bash",
    });
    expect(yaml).toContain("curl --silent --show-error --fail");
    expect(yaml).toContain("X-QNote-Pipeline-Id: $CI_PIPELINE_ID");
    expect(yaml).toContain("X-QNote-Project-Id: $CI_PROJECT_ID");
    expect(yaml).toContain("X-QNote-Relay-Token: $QNOTE_RELAY_TOKEN");
  });

  it("默认按当前平台选 shell", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
    });
    if (process.platform === "win32") {
      expect(yaml).toContain("curl.exe");
    } else {
      expect(yaml).toContain("curl --silent --show-error --fail");
    }
  });

  it("带上 runner 标签", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "powershell",
      tags: ["qnote", "bot"],
    });
    expect(yaml).toContain("tags:");
    expect(yaml).toContain("    - qnote");
    expect(yaml).toContain("    - bot");
  });

  it("没给标签时默认 qnote", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "powershell",
    });
    expect(yaml).toContain("    - qnote");
  });

  it("PowerShell 模板里不出现行尾反斜杠续行", () => {
    const yaml = buildCiTemplate({
      relayUrl: "http://127.0.0.1:7799/gitlab/relay",
      relayToken: "qnrelay_x",
      projectPath: "team/app",
      shell: "powershell",
    });
    for (const line of yaml.split("\n")) {
      expect(line.endsWith("\\")).toBe(false);
    }
  });
});
