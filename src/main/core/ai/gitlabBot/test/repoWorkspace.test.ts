// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}));

import {
  buildWorkBranchName,
  credentialHelperPath,
  projectDirName,
} from "../task/repoWorkspace";

describe("仓库工作区", () => {
  it("项目路径转成安全的目录名", () => {
    expect(projectDirName("team/app")).toBe("team__app");
    expect(projectDirName("group/sub/app")).toBe("group__sub__app");
    expect(projectDirName("a/b c")).toBe("a__b_c");
  });

  it("目录名不越出工作区", () => {
    expect(projectDirName("..")).toBe("_");
    expect(projectDirName(".")).toBe("_");
    expect(projectDirName("")).toBe("_");
  });

  it("凭据助手路径用正斜杠并加引号", () => {
    const helper = credentialHelperPath("C:\\Users\\me\\AppData\\Local\\Temp\\cred 1.txt");
    expect(helper).toBe("'C:/Users/me/AppData/Local/Temp/cred 1.txt'");
    expect(helper).not.toContain("\\");
  });

  it("按 issue 和合并请求给不同的分支", () => {
    expect(buildWorkBranchName({ issueIid: 12 })).toBe("qnote/issue-12");
    expect(buildWorkBranchName({ mrIid: 5 })).toBe("qnote/mr-5");
    expect(buildWorkBranchName({ mrIid: 5, issueIid: 12 })).toBe("qnote/mr-5");
    expect(buildWorkBranchName({})).toMatch(/^qnote\/task-\d+$/);
  });
});
