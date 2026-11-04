// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  AI_IMAGE_ALLOWED_MIMES,
  AI_IMAGE_MAX_COUNT,
  AI_IMAGE_MAX_DATA_CHARS,
  aiContentToText,
  aiImageContentBlocks,
  aiImageDataUrl,
  buildUserContent,
  normalizeAiImages,
  parseAiImageDataUrl,
  parseAiImages,
  serializeAiImages,
} from "./aiImages";

/**
 * 图片附件的协议与校验
 *
 * 这套类型主进程与渲染层共用，附件又是通过 IPC 传进来的外部输入 ——
 * 主进程不能假设传进来的东西合法。这批用例锁的是「哪些附件被接受、
 * 哪些被丢掉、整批怎么处理」。
 *
 * 纯函数，不碰文件系统。
 */

const PNG = { mime: "image/png", data: "aGVsbG8=" };

describe("data URL 与附件互转", () => {
  it("附件拼成 data URL", () => {
    expect(aiImageDataUrl(PNG)).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("data URL 解析回附件", () => {
    expect(parseAiImageDataUrl("data:image/png;base64,aGVsbG8=")).toEqual({
      mime: "image/png",
      data: "aGVsbG8=",
    });
  });

  it("MIME 统一转小写", () => {
    expect(parseAiImageDataUrl("data:IMAGE/PNG;base64,aGVsbG8=")?.mime).toBe("image/png");
  });

  it("格式不对时返回 null", () => {
    expect(parseAiImageDataUrl("")).toBeNull();
    expect(parseAiImageDataUrl("不是 data URL")).toBeNull();
    expect(parseAiImageDataUrl("data:image/png,不是base64")).toBeNull();
    // base64 里带空白就匹配不上 —— Anthropic 侧的解析正则同样不容忍空白
    expect(parseAiImageDataUrl("data:image/png;base64,aGVs bG8=")).toBeNull();
  });
});

describe("批量校验 normalizeAiImages", () => {
  it("合法附件原样保留", () => {
    expect(normalizeAiImages([PNG])).toEqual([PNG]);
  });

  it("非数组一律当作空", () => {
    expect(normalizeAiImages(null)).toEqual([]);
    expect(normalizeAiImages(undefined)).toEqual([]);
    expect(normalizeAiImages("不是数组")).toEqual([]);
    expect(normalizeAiImages({ mime: "image/png", data: "x" })).toEqual([]);
  });

  it("非法的单张被丢掉，其余照常通过", () => {
    const result = normalizeAiImages([
      PNG,
      { mime: "image/bmp", data: "aGVsbG8=" }, // MIME 不在白名单
      { mime: "image/png" }, // 缺 data
      { data: "aGVsbG8=" }, // 缺 mime
      { mime: "image/png", data: "有空白 base64" }, // base64 字符非法
      null,
      "字符串",
    ]);

    expect(result).toEqual([PNG]);
  });

  it("MIME 与 data 两端空白会被清掉", () => {
    const result = normalizeAiImages([{ mime: "  image/png  ", data: "  aGVsbG8=  " }]);

    expect(result).toEqual([{ mime: "image/png", data: "aGVsbG8=", name: undefined }]);
  });

  it("超量时只留前几张", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      mime: "image/png",
      data: `aGVsbG8${i}`,
    }));

    const result = normalizeAiImages(many);

    expect(result).toHaveLength(AI_IMAGE_MAX_COUNT);
    expect(result[0].data).toBe("aGVsbG80");
  });

  it("单张超过长度上限被丢掉（防止绕过渲染层塞巨图）", () => {
    const huge = { mime: "image/png", data: "a".repeat(AI_IMAGE_MAX_DATA_CHARS + 1) };

    expect(normalizeAiImages([huge])).toEqual([]);
  });

  it("白名单只有这四种格式", () => {
    expect([...AI_IMAGE_ALLOWED_MIMES]).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });
});

describe("落库用的序列化与反序列化", () => {
  it("序列化成 JSON 字符串", () => {
    expect(serializeAiImages([PNG])).toBe('[{"mime":"image/png","data":"aGVsbG8="}]');
  });

  it("空数组序列化成空串", () => {
    expect(serializeAiImages([])).toBe("");
  });

  it("带 name 时写进 JSON，不带时字段不出现", () => {
    expect(serializeAiImages([{ ...PNG, name: "截图.png" }])).toContain('"name":"截图.png"');
    expect(serializeAiImages([PNG])).not.toContain("name");
  });

  it("反序列化后拿到附件", () => {
    expect(parseAiImages('[{"mime":"image/png","data":"aGVsbG8="}]')).toEqual([PNG]);
  });

  it("反序列化时同样走校验（库里存了脏数据也不放行）", () => {
    expect(parseAiImages('[{"mime":"image/bmp","data":"aGVsbG8="}]')).toEqual([]);
  });

  it("结构不对时当作没有（不让整个历史读取失败）", () => {
    expect(parseAiImages("")).toEqual([]);
    expect(parseAiImages(null)).toEqual([]);
    expect(parseAiImages("{不是 JSON")).toEqual([]);
    expect(parseAiImages('{"mime":"image/png"}')).toEqual([]);
  });
});

describe("发给模型的内容块", () => {
  it("图片排在前、文本排在后", () => {
    const blocks = buildUserContent("这是什么", [PNG]);

    expect(blocks).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      { type: "text", text: "这是什么" },
    ]);
  });

  it("没有图时退回纯文本（字符串，不是块数组）", () => {
    expect(buildUserContent("  你好  ", [])).toBe("你好");
    expect(buildUserContent("你好", [])).toBe("你好");
  });

  it("只有图没有字时只给图片块，不塞空文本块", () => {
    const blocks = buildUserContent("   ", [PNG]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image_url");
  });

  it("内容块就是 data URL 形式的图片", () => {
    expect(aiImageContentBlocks([PNG])).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ]);
  });
});

describe("内容抽纯文本 aiContentToText", () => {
  it("字符串原样返回", () => {
    expect(aiContentToText("一段文字")).toBe("一段文字");
  });

  it("块数组只取文本块", () => {
    const content = [
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      { type: "text", text: "第一段" },
      { type: "text", text: "第二段" },
    ];

    expect(aiContentToText(content)).toBe("第一段\n第二段");
  });

  it("只有图没有字时得到空串（不是 undefined）", () => {
    expect(aiContentToText([{ type: "image_url", image_url: { url: "x" } }])).toBe("");
  });

  it("不是字符串也不是数组时得到空串", () => {
    expect(aiContentToText(null)).toBe("");
    expect(aiContentToText(undefined)).toBe("");
    expect(aiContentToText(42)).toBe("");
  });
});
