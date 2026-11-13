/**
 * 应用管理 —— 主进程与渲染层共用的类型
 *
 * ## 概念
 *
 * - **项目（project）**：用户直接导入的一个文件夹 + 一份 `qnote.json` 清单。
 *   清单是唯一的规范来源：没有清单的项目不可启动、不可预览，界面上标为「未配置」。
 * - **运行时（runtime）**：项目启动命令对应的常驻进程，以及它的实时输出。
 *
 * 项目之间没有父子关系 —— 导入的就是项目本身，因此项目可以散落在
 * 任意不同的目录下。
 *
 * 规范全文见 docs/APP-MANAGEMENT.md。
 */

/** `qnote.json` 规范化后的结果 —— 字段已按规范校验过，非法字段被剔除 */
export interface AppManifest {
  /** 展示名；未填时用文件夹名 */
  name?: string;
  /** 项目简介，仅展示 */
  description?: string;
  /** 一行启动命令，在工作目录里经 shell 执行 */
  command?: string;
  /** 追加给命令的参数 */
  args?: string[];
  /** 工作目录，相对项目根；缺省即项目根本身 */
  cwd?: string;
  /** 额外环境变量 */
  env?: Record<string, string>;
  /** HTML 预览入口：相对路径（走 qnote-app:// 协议）或 http(s) 网址 */
  preview?: string;
}

/**
 * 项目可用性
 * - ready：清单合法，可启动 / 可预览
 * - missing-manifest：目录下没有 qnote.json
 * - invalid-manifest：有 qnote.json 但解析不通过
 */
export type AppProjectStatus = "ready" | "missing-manifest" | "invalid-manifest";

/**
 * 项目的来源
 *
 * - `local` —— 用户自己导入的。清单是他自己写的，运行前不需要额外确认。
 * - `market` —— 从应用市场获取的。清单是**别人**写的，属于不可信输入，
 *   第一次运行前必须由用户显式确认。
 */
export type AppOrigin = "local" | "market";

export interface AppProject {
  id: number;
  /** 展示名 */
  name: string;
  /** 项目根目录绝对路径 */
  path: string;
  status: AppProjectStatus;
  /** 清单原文，出错时展示给用户看 */
  manifestText?: string;
  /** 规范化后的启动命令（command 与 args 拼接后的结果） */
  command?: string;
  /** 预览入口 */
  preview?: string;
  /** 项目简介 */
  description?: string;
  /** 不可用原因 */
  error?: string;
  /** 来源 —— 本机导入还是从市场获取 */
  origin?: AppOrigin;
  /**
   * 用户已确认过的清单指纹
   *
   * 存的是**清单内容的哈希**而不是布尔值 —— 清单改了（作者更新、
   * 本地被人动过）哈希就对不上，确认框会再弹一次。
   */
  confirmedManifestHash?: string;
}

/**
 * 启动前需要用户确认时返回的信息
 *
 * 主进程不知道用户同不同意，所以它只把「需要确认」这件事和该看的东西
 * 一起交回渲染层 —— 由渲染层弹确认框，用户点了再带着确认结果回来。
 */
export interface StartConfirmation {
  projectId: number;
  /** 项目名 */
  name: string;
  /** 完整命令行 —— 不截断，用户要能自己看清楚 */
  commandLine: string;
  /** 来源 */
  origin: AppOrigin;
  /** 风险分析结果 */
  risk: import("./appRisk").RiskReport;
  /** 清单指纹 —— 用户确认后带回来，主进程核对是不是同一份 */
  manifestHash: string;
  /** 来源说明（市场条目的话是作者署名） */
  sourceLabel?: string;
}

/**
 * 导入失败的原因分类
 *
 * 区分开是为了让界面能给出不同的补救动作：
 * 缺清单 → 提供「生成 qnote.json」；清单坏了 → 提供「修正清单」。
 */
export type AppImportFailureReason =
  | "not-a-directory"
  | "missing-manifest"
  | "invalid-manifest"
  | "already-imported";

export interface AppImportResult {
  ok: boolean;
  /** 失败原因（中文，可直接展示） */
  error?: string;
  /** 失败分类 */
  reason?: AppImportFailureReason;
  /** 导入的项目；成功时才有 */
  project?: AppProject;
}

/** 进程运行状态 */
export type AppRunStatus =
  /** 未启动 */
  | "stopped"
  /** 已拉起，尚未收到任何输出 */
  | "starting"
  /** 运行中 */
  | "running"
  /** 进程自己退出了（正常或非正常，见 exitCode） */
  | "exited"
  /** 启动失败（命令不存在、目录不存在等） */
  | "failed";

export interface AppRuntimeState {
  projectId: number;
  status: AppRunStatus;
  /** 操作系统进程号 */
  pid?: number;
  /** 退出码；仅在 status 为 exited 时有值 */
  exitCode?: number;
  /** 启动时刻（毫秒时间戳） */
  startedAt?: number;
  /** 结束时刻（毫秒时间戳） */
  endedAt?: number;
  /** 失败原因 */
  error?: string;
}

/** 日志行的来源 */
export type AppLogStream = "stdout" | "stderr" | "system";

export interface AppLogLine {
  projectId: number;
  stream: AppLogStream;
  text: string;
  /** 毫秒时间戳 */
  at: number;
}
