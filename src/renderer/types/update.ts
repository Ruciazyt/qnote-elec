/**
 * 应用更新相关的渲染层类型
 *
 * 单独成文件而不是写在 electron.d.ts 里：那份文件描述的是 Window 上的
 * electron 对象接口，interface 体内没法再声明 type / interface。
 * 约定与项目里既有的 clipboard/types.ts 一致 —— d.ts 里用
 * import("./types/update").UpdateStatus 内联引用。
 */

/** 更新流程状态 —— 与主进程 core/updater.ts 的 UpdatePhase 严格对应 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export interface UpdateStatus {
  phase: UpdatePhase;
  /** 当前运行中的版本 */
  currentVersion: string;
  /** 线上最新版本 */
  latestVersion?: string;
  /** Release 标题 */
  releaseName?: string;
  /** 更新说明（Markdown 原文） */
  releaseNotes?: string;
  /** 发布时间 */
  releaseDate?: string;
  /** 下载进度 0~100 */
  percent?: number;
  /** 已下载字节 */
  transferred?: number;
  /** 总字节 */
  total?: number;
  /** 速度（字节/秒） */
  bytesPerSecond?: number;
  /** 错误信息（面向用户的中文描述） */
  error?: string;
  /** phase=unsupported 时的原因说明 */
  reason?: string;
}

/** 运行环境信息 */
export interface UpdateEnvironment {
  packaged: boolean;
  portable: boolean;
  releasesUrl: string;
}
