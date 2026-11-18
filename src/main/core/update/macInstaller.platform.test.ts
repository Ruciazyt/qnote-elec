// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  const posix = actual.posix;
  const posixPath = {
    ...actual,
    sep: "/",
    delimiter: ":",
    dirname: posix.dirname,
    basename: posix.basename,
    join: posix.join,
    resolve: posix.resolve,
    relative: posix.relative,
    extname: posix.extname,
    isAbsolute: posix.isAbsolute,
    normalize: posix.normalize,
    parse: posix.parse,
    format: posix.format,
  };
  return { ...posixPath, default: posixPath };
});

import { buildInstallScript } from "./macInstaller";

const options = {
  archivePath: "/Users/test/Library/Caches/qnote-update/QNote-1.13.0-mac-arm64.zip",
  bundlePath: "/Applications/QNote.app",
  appName: "QNote.app",
  logPath: "C:\\Users\\test\\AppData\\Roaming\\QNote\\install.log",
  scriptPath: "/Users/test/Library/Application Support/QNote/qnote-mac-updater/install.sh",
  pid: 4242,
  waitSeconds: 120,
};

describe("mac 安装脚本的跨平台一致性", () => {
  it("在 POSIX 宿主下同样使用正斜杠，暂存目录不塌陷", () => {
    const script = buildInstallScript(options);

    expect(script).toContain(
      "ARCHIVE='/Users/test/Library/Caches/qnote-update/QNote-1.13.0-mac-arm64.zip'"
    );
    expect(script).toContain("BUNDLE='/Applications/QNote.app'");
    expect(script).toContain("STAGE='C:/Users/test/AppData/Roaming/QNote/staged'");
    expect(script).toContain("LOG='C:/Users/test/AppData/Roaming/QNote/install.log'");
    expect(script).not.toMatch(/[A-Za-z]:\\\\/);
  });
});
