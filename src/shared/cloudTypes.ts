/**
 * 云端存储 —— 主进程与渲染层共用的类型
 *
 * ## 分工
 *
 * QNote 的数据分两层：
 *
 * - **私有数据**（笔记、剪贴板、Todo、AI 对话、快捷方式……）**永远留在本地
 *   SQLite**。这些数据是用户自有的，不该出现在任何共享的存储里。
 * - **共享数据**（发布出去的 APP 目录）可以放在**云端 D1**，这样别的机器、
 *   别的用户能看见同一份目录。
 *
 * 云端只承载「所有人都能看的」那部分 —— 见 docs/CLOUD-STORAGE.md。
 *
 * ## 为什么要「双后端 + 可切换」
 *
 * 云端挂了、被墙了、用户压根没配 D1 —— 这些时候应用必须照常能用。
 * 所以共享存储有两个实现（本地 / D1），接口完全一样，
 * 用户可以在设置里切换，切换不影响任何私有数据。
 */

/**
 * 共享存储的后端类型
 *
 * - `local` —— 本地 SQLite（默认，永远可用）
 * - `d1` —— **直连** Cloudflare D1：用户填自己的账号 ID / 库 ID / Token
 * - `public` —— **公共目录**：走 Cloudflare Worker 代理，客户端零配置
 */
export type CloudBackend = "local" | "d1" | "public";

/** D1 连接配置 —— 全部来自用户在设置页的输入，不进仓库 */
export interface D1Config {
  /** Cloudflare 账号 ID */
  accountId: string;
  /** D1 数据库 ID（UUID） */
  databaseId: string;
  /** API Token，需要 D1 Read + D1 Write 权限 */
  apiToken: string;
}

/**
 * 云端存储的完整配置
 *
 * 存放在**本地** SQLite 的 settings 表里 —— 配置本身是本地的，
 * 但它决定共享数据去哪。注意这意味着：切到 D1 之前，
 * 得先能在本地读到这份配置（见 docs/CLOUD-STORAGE.md 的「启动顺序」）。
 */
export interface CloudStorageConfig {
  /** 当前后端 */
  backend: CloudBackend;
  /** 直连 D1 时的配置；后端为 local / public 时可以为空 */
  d1: D1Config | null;
  /** 公共目录（Worker 代理）地址；后端为 public 时不能为空 */
  endpoint: string | null;
  /** 上次连通性检查的结果摘要（仅用于界面展示，不参与逻辑判断） */
  lastCheck?: CloudConnectionStatus | null;
}

/** 连通性检查的结果 */
export interface CloudConnectionStatus {
  ok: boolean;
  /** 失败时的中文原因 */
  error?: string;
  /** 探测到的 D1 库名（有权限时能读到） */
  databaseName?: string;
  /** 探测到的表数量 */
  tableCount?: number;
  /** 成功时的补充说明 */
  detail?: string;
}

/**
 * 一条已发布的 APP
 *
 * 这是共享存储里唯一的数据形态。字段刻意做得很窄：
 * 共享目录要能被所有人看见，就不能带上任何本机路径、
 * 私有笔记内容之类的东西。
 */
export interface PublishedApp {
  /** 全局唯一 ID —— 发布时生成，形如 `app_3f9a2c1b` */
  id: string;
  /** 展示名 */
  name: string;
  /** 一句话简介 */
  description: string;
  /** 作者署名 */
  author: string;
  /** 清单原文（qnote.json 的内容）—— 别的机器导入时据此重建项目 */
  manifest: string;
  /** 源码 / 下载地址 */
  repoUrl: string;
  /** 标签，逗号分隔 */
  tags: string;
  /** 被「获取」的次数 */
  pulls: number;
  /** 发布时间（毫秒时间戳） */
  createdAt: number;
  /** 最后更新时间（毫秒时间戳） */
  updatedAt: number;
}

/** 发布 / 更新一条 APP 的入参 */
export interface PublishedAppInput {
  name: string;
  description?: string;
  author?: string;
  /** 清单原文（qnote.json） */
  manifest: string;
  repoUrl?: string;
  tags?: string;
}

/** 市场列表的查询条件 */
export interface PublishedAppQuery {
  /** 按名称 / 简介 / 标签模糊匹配 */
  keyword?: string;
  /** 返回条数上限 */
  limit?: number;
  /** 跳过的条数 */
  offset?: number;
}

/** 市场列表的返回 */
export interface PublishedAppListResult {
  apps: PublishedApp[];
  /** 命中的总条数 */
  total: number;
}
