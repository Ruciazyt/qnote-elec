/// <reference types="vite/client" />

interface ElectronAPI {
  // Window controls
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  openDevTools: () => void;

  // Clipboard events
  onClipboardChanged: (callback: (event: unknown, data: import("./components/clipboard/types").ClipboardRecord) => void) => void;
  removeClipboardChanged: (callback: (event: unknown, data: unknown) => void) => void;
  getClipboardHistory: () => Promise<import("./components/clipboard/types").ClipboardRecord[]>;

  // File operations
  getFilePath: () => Promise<string>;
  selectDirs: () => Promise<string | undefined>;
  // 笔记文件（纯文件制，类型由扩展名决定；主进程是唯一写入口）
  getNoteTree: (dirPath: string) => Promise<import("../shared/noteTypes").NoteTreeNode[]>;
  /**
   * 外部文件夹（笔记页侧栏下半部分）
   *
   * 渲染层只认 id —— 路径由主进程从注册表里查。
   */
  getExternalFolders: () => Promise<import("../shared/noteTypes").ExternalFolder[]>;
  /** 弹系统目录选择框并登记选中的文件夹；用户取消时返回 null */
  addExternalFolders: () => Promise<import("../shared/noteTypes").ExternalFolder[] | null>;
  /** 从清单里移除（不动磁盘上的文件） */
  removeExternalFolder: (id: string) => Promise<import("../shared/noteTypes").ExternalFolder[]>;
  /** 列出某个外部文件夹里的目录树 */
  getExternalTree: (id: string) => Promise<import("../shared/noteTypes").NoteTreeNode[]>;
  /** 在文件管理器里定位外部文件夹里的条目 */
  revealExternalFile: (id: string, relPath: string) => Promise<boolean>;
  /** 外部文件夹的文件管理：删除 / 重命名 / 新建 / 移动 / 拖入文件 */
  deleteExternalFile: (id: string, relPath: string) => Promise<boolean>;
  deleteExternalFolder: (id: string, relPath: string) => Promise<boolean>;
  renameExternalEntry: (id: string, oldRel: string, newName: string) => Promise<boolean>;
  createExternalFolder: (id: string, parentRel: string, name: string) => Promise<boolean>;
  createExternalFile: (
    id: string,
    parentRel: string,
    name: string,
    type: import("../shared/noteTypes").NoteType
  ) => Promise<{ ok: true; relPath: string } | { ok: false; reason: string }>;
  moveExternalEntry: (
    id: string,
    fromRel: string,
    toFolderRel: string
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  importExternalFiles: (
    id: string,
    srcPaths: string[],
    targetFolderRel?: string
  ) => Promise<{ imported: string[]; skipped: string[] }>;
  /** Electron 32+ 移除了 File.path，取磁盘路径只能走这个 */
  getPathForFile: (file: File) => string;
  importNoteFiles: (
    dirPath: string,
    srcPaths: string[],
    targetFolderRel?: string
  ) => Promise<{ imported: string[]; skipped: string[] }>;
  readNote: (dirPath: string, relPath: string) => Promise<import("../shared/noteTypes").NoteContent | null>;
  writeNote: (dirPath: string, relPath: string, text: string) => Promise<boolean>;
  // 富文本 .md：本地图片相对路径 ⇄ dataUrl 的转换在主进程完成
  readMarkdownNote: (dirPath: string, relPath: string) => Promise<string>;
  writeMarkdownNote: (dirPath: string, relPath: string, markdown: string) => Promise<boolean>;
  // HTML 笔记：本地图片相对路径 ⇄ dataUrl 的转换同样在主进程完成
  readHtmlNote: (dirPath: string, relPath: string) => Promise<string>;
  writeHtmlNote: (dirPath: string, relPath: string, html: string) => Promise<boolean>;
  /** 笔记目录被外部改动（AI 写入笔记）时触发，回调参数为笔记根目录 */
  onNotesChanged: (callback: (root: string) => void) => () => void;
  saveImageAsset: (dirPath: string, dataUrl: string) => Promise<string | null>;
  saveClipboardRecordAsNote: (
    dirPath: string,
    type: "text" | "image",
    content: string
  ) => Promise<import("../shared/noteTypes").NoteFileEntry | null>;
  pickAndSaveImage: (dirPath: string) => Promise<{ dataUrl: string; assetRel: string } | null>;
  deleteNoteFile: (dirPath: string, relPath: string) => Promise<boolean>;
  deleteNoteFolder: (dirPath: string, relPath: string) => Promise<boolean>;
  renameNoteEntry: (dirPath: string, oldRel: string, newName: string) => Promise<boolean>;
  createNoteFolder: (dirPath: string, parentRel: string, name: string) => Promise<boolean>;
  /**
   * 新建一篇空白笔记。
   * 成功返回 { ok: true, relPath }，失败返回 { ok: false, reason }；
   * 后缀按类型决定，同名自动追加 -2 / -3，不会覆盖已有文件。
   */
  createNoteFile: (
    dirPath: string,
    parentRel: string,
    name: string,
    type: import("../shared/noteTypes").NoteType
  ) => Promise<{ ok: true; relPath: string } | { ok: false; reason: string }>;
  moveNoteEntry: (
    dirPath: string,
    fromRel: string,
    toFolderRel: string
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** 打开系统文件管理器；空串表示成功，否则是错误信息 */
  openInExplorer: (dirPath: string, relPath: string) => Promise<string>;
  revealInFolder: (dirPath: string, relPath: string) => Promise<boolean>;
  saveClipboardImageNote: (dirPath: string, parentRel: string) => Promise<import("../shared/noteTypes").NoteFileEntry | null>;

  // OCR
  baiduOcr: (imageBase64: string) => Promise<string>;
  baiduOcrAccurate: (imageBase64: string) => Promise<string>;
  baiduOcrWebImage: (imageUrl: string) => Promise<string>;
  copyImageToClipboard: (imageDataUrl: string) => Promise<void>;
  /** 写剪贴板前登记「本次复制来自应用内」，监听器据此跳过，不再重复记录 */
  markClipboardCopied: (content: string) => Promise<boolean>;
  getBaiduKeys: () => Promise<{ apiKey: string; secretKey: string }>;
  setBaiduKeys: (apiKey: string, secretKey: string) => Promise<{ success: boolean; error?: string }>;

  // Notes
  searchNotes: (keyword: string) => Promise<import("./components/clipboard/types").ClipboardRecord[]>;
  deleteNoteById: (id: number) => Promise<boolean>;
  deleteAllNotes: () => Promise<{ success: boolean; deleted?: number; error?: string }>;
  /** 清空前统计：会保留多少条（置顶/重要） */
  countProtectedNotes: () => Promise<{ kept: number; total: number; removable: number }>;
  updateNoteContent: (noteId: number, content: string) => Promise<{ success: boolean; error?: string }>;
  toggleNotePin: (noteId: number, pinned: boolean) => Promise<{ success: boolean; error?: string; pinned_at: number | null }>;
  toggleNoteImportant: (noteId: number, important: boolean) => Promise<{ success: boolean; error?: string }>;

  // Templates
  getTemplates: () => Promise<unknown[]>;
  saveTemplate: (template: {
    id: string;
    name: string;
    content: string;
    category: string;
    isCustom?: boolean;
  }) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

  // AI 技能（Skill）
  getAiSkills: () => Promise<Array<{
    id: string;
    name: string;
    content: string;
    category: string;
    isCustom: boolean;
    createdAt?: string;
    updatedAt?: string;
  }>>;
  saveAiSkill: (skill: { id?: string; name: string; content: string }) => Promise<{
    success: boolean;
    id?: string;
    error?: string;
  }>;
  deleteAiSkill: (id: string) => Promise<{ success: boolean; deleted?: number; error?: string }>;
  /** 预览远程 skill（只拉取解析，不写库） */
  previewAiSkillUrl: (url: string) => Promise<{
    success: boolean;
    skills: Array<{ name: string; content: string }>;
    rawPreview: string;
    rejected: Array<{ name: string; reason: string }>;
    error?: string;
  }>;
  /** 确认导入（同名覆盖） */
  importAiSkills: (skills: Array<{ name: string; content: string }>) => Promise<{
    success: boolean;
    imported?: string[];
    updated?: string[];
    skipped?: Array<{ name: string; reason: string }>;
    error?: string;
  }>;

  // AI
  cancelAiMessage: (sessionId: string) => void;
  onAiStreamChunk: (
    callback: (event: unknown, payload: { sessionId: string; delta: string }) => void
  ) => () => void;
  onAiStreamEnd: (
    callback: (event: unknown, payload: { sessionId: string; content: string }) => void
  ) => () => void;
  onAiStreamError: (
    callback: (event: unknown, payload: { sessionId: string; error: string }) => void
  ) => () => void;
  /**
   * 会话压缩进度：'compressing' 时显示「正在压缩历史…」，'done' 时收起。
   * 压缩要额外调一次 LLM，没有这个反馈用户只会看到界面卡住。
   */
  onAiCompacting: (
    callback: (
      event: unknown,
      payload: {
        sessionId: string;
        phase: "comppressing" | "done";
        round?: number;
        maxRounds?: number;
        tokens?: number;
      }
    ) => void
  ) => () => void;
  // Agent 模式
  // skillId：选中的 AI 技能（可选，null = 不使用）
  // images：本轮带的图片附件（可选）
  sendAiAgentStream: (
    message: string,
    sessionId?: string,
    chatSessionId?: string,
    skillId?: string | null,
    images?: import("@shared/aiImages").AiImageAttachment[]
  ) => Promise<{ sessionId: string }>;
  // 打开系统选图框，返回原始图片，由渲染层缩图
  pickAiImages: () => Promise<import("@shared/aiImages").AiImageAttachment[]>;
  onAiStreamToolCall: (
    callback: (
      event: unknown,
      payload: { sessionId: string; id: string; name: string; args: Record<string, any> }
    ) => void
  ) => () => void;
  onAiStreamToolResult: (
    callback: (
      event: unknown,
      payload: {
        sessionId: string;
        id: string;
        name: string;
        result: string;
        isError: boolean;
      }
    ) => void
  ) => () => void;
  /** 轮次撞上限，主进程问用户「是否继续」；这条不发 end */
  onAiNeedContinue: (
    callback: (
      event: unknown,
      payload: { sessionId: string; rounds: number; totalRounds: number }
    ) => void
  ) => () => void;
  continueAiAgent: (
    sessionId: string,
    decision: "continue" | "stop"
  ) => Promise<{ ok: boolean; error?: string }>;

  // AI 用量统计（设置页可视化）
  getAiUsageStats: () => Promise<{
    today: import("../main/utils/ai/observability/usageStats").UsageTotals;
    week: import("../main/utils/ai/observability/usageStats").UsageTotals;
    all: import("../main/utils/ai/observability/usageStats").UsageTotals;
    byModel: import("../main/utils/ai/observability/usageStats").UsageByModel[];
    byDay: import("../main/utils/ai/observability/usageStats").UsageByDay[];
    recent: import("../main/utils/ai/observability/usageStats").UsageRecordRow[];
  }>;
  clearAiUsageLog: () => Promise<{ success: boolean; deleted?: number; error?: string }>;
  getAiChatSessions: () => Promise<import("./components/clipboard/types").AiChatSession[]>;
  createAiChatSession: () => Promise<import("./components/clipboard/types").AiChatSession>;
  getAiChatSessionHistory: (chatSessionId: string) => Promise<Array<Omit<import("./components/clipboard/types").ChatMessage, "toolCalls"> & { tool_calls: import("./components/clipboard/types").ToolCallRecord[] }>>;
  deleteAiChatSession: (chatSessionId: string) => Promise<boolean>;
  clearAiChat: () => Promise<boolean>;
  getAiConfig: () => Promise<{ provider: string; apiKey: string; model: string; baseUrl: string }>;
  setAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => Promise<boolean>;
  validateAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => Promise<boolean>;
  saveOcrResult: (noteId: number, ocrResult: string) => Promise<void>;

  // Todo
  todoList: () => Promise<import("./components/todo/types").Todo[]>;
  todoCreate: (input: import("./components/todo/types").TodoInput) => Promise<import("./components/todo/types").Todo>;
  todoUpdate: (id: number, patch: import("./components/todo/types").TodoUpdateInput) => Promise<import("./components/todo/types").Todo>;
  todoDelete: (id: number) => Promise<boolean>;
  todoToggle: (id: number) => Promise<import("./components/todo/types").Todo>;
  todoArchive: (id: number) => Promise<import("./components/todo/types").Todo>;
  todoUnarchive: (id: number) => Promise<import("./components/todo/types").Todo>;
  /** 订阅 Todo 列表变更（待办页用它跨页刷新），返回取消订阅函数 */
  onTodosChanged: (callback: () => void) => () => void;

  // Memory index
  // 只声明渲染层真在用的四个；检索 / 批量索引 / 配置读写走主进程内部能力。
  addToMemory: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  removeFromMemory: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  getMemoryCount: () => Promise<{ success: boolean; count?: number; error?: string }>;
  clearMemoryStore: () => Promise<{ success: boolean; error?: string }>;

  // Data migration
  exportDatabase: () => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;
  importDatabase: () => Promise<{ success: boolean; error?: string; canceled?: boolean }>;
  onImportProgress: (callback: (event: unknown, progress: unknown) => void) => void;
  removeImportProgress: (callback: (event: unknown, progress: unknown) => void) => void;

  // Leetcode
  getLeetcodeCollections: () => Promise<unknown[]>;
  getLeetcodeCollection: (id: number) => Promise<unknown>;
  saveLeetcodeCollection: (collection: {
    id?: number;
    name: string;
    summary: string;
    problems?: Array<{
      id?: number;
      link: string;
      is_completed: boolean;
      title?: string;
      difficulty?: string;
    }>;
  }) => Promise<unknown>;
  deleteLeetcodeCollection: (id: number) => Promise<void>;
  updateLeetcodeProblem: (
    problemId: number,
    updates: { link?: string; is_completed?: boolean; difficulty?: string }
  ) => Promise<void>;
  getLeetcodeProblemTitle: (url: string) => Promise<{ success: boolean; title?: string; difficulty?: string; error?: string }>;
  importLeetcodeCollection: (text: string) => Promise<unknown>;

  // Shell
  openExternal: (url: string) => Promise<boolean>;

  // ==================== 内嵌浏览器 ====================
  // 网页内容由主进程 WebContentsView 承载，渲染进程只负责工具栏 UI 与位置同步
  browserGetState: () => Promise<import("./components/browser/types").BrowserState>;
  browserCreateTab: (url?: string) => Promise<import("./components/browser/types").BrowserState>;
  browserCloseTab: (tabId: string) => Promise<import("./components/browser/types").BrowserState>;
  browserActivateTab: (tabId: string) => Promise<import("./components/browser/types").BrowserState>;
  browserLoadUrl: (tabId: string, url: string) => Promise<void>;
  browserNavigate: (
    tabId: string,
    action: "back" | "forward" | "reload" | "stop"
  ) => Promise<void>;
  browserSetBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
  browserSetVisible: (visible: boolean) => Promise<void>;
  /**
   * 借出网页表层，让渲染层浮层显示在网页之上。
   * 返回 token，关闭浮层时必须用 browserReleaseSurface 归还，否则表层会一直隐藏。
   */
  browserBorrowSurface: () => Promise<number>;
  browserReleaseSurface: (token: number) => Promise<boolean>;
  /** 兜底：一次性归还全部借出（组件异常卸载时用） */
  browserReleaseAllSurfaces: () => Promise<number>;
  onBrowserTabsChanged: (
    callback: (state: import("./components/browser/types").BrowserState) => void
  ) => () => void;
  onBrowserTabUpdated: (
    callback: (tab: import("./components/browser/types").BrowserTabState) => void
  ) => () => void;
  onBrowserLoadError: (
    callback: (payload: import("./components/browser/types").BrowserLoadError) => void
  ) => () => void;

  // ==================== 浏览器收藏 ====================
  browserBookmarkList: () => Promise<import("./components/browser/types").BookmarkRow[]>;
  browserBookmarkIsSaved: (url: string) => Promise<boolean>;
  browserBookmarkAdd: (
    url: string,
    title?: string
  ) => Promise<{ success: boolean; error?: string }>;
  browserBookmarkRemove: (url: string) => Promise<{ success: boolean; error?: string }>;
  browserBookmarkDelete: (id: number) => Promise<boolean>;
  browserBookmarkClear: () => Promise<boolean>;

  // ==================== 应用管理 ====================
  appListProjects: () => Promise<import("@shared/appTypes").AppProject[]>;  appImportProject: (dirPath: string) => Promise<import("@shared/appTypes").AppImportResult>;
  appRemoveProject: (id: number) => Promise<{ ok: boolean; error?: string }>;
  appRefreshProjects: () => Promise<import("@shared/appTypes").AppProject[]>;
  appWriteManifest: (
    projectPath: string,
    payload: {
      name?: string;
      description?: string;
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      preview?: string;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  appOpenFolder: (target: string) => Promise<{ ok: boolean; error?: string }>;
  appPickProjectDir: () => Promise<string | null>;
  appStart: (
    projectId: number,
    confirmedManifestHash?: string
  ) => Promise<{
    ok: boolean;
    error?: string;
    needsConfirmation?: import("@shared/appTypes").StartConfirmation;
  }>;
  /** 从应用市场导入一个项目 —— 目标目录已有 qnote.json 时拒绝覆盖 */
  appImportFromMarket: (
    dirPath: string,
    payload: Partial<import("@shared/appTypes").AppManifest>
  ) => Promise<import("@shared/appTypes").AppImportResult>;
  appStop: (projectId: number) => Promise<{ ok: boolean; error?: string }>;
  appRuntimeStates: () => Promise<import("@shared/appTypes").AppRuntimeState[]>;
  appLogs: (projectId: number) => Promise<import("@shared/appTypes").AppLogLine[]>;
  appClearLogs: (projectId: number) => Promise<boolean>;
  appPreviewLoad: (projectId: number) => Promise<{
    ok: boolean;
    error?: string;
    /** 真正加载的 URL */
    url?: string;
    /** 给人看的地址（本地文件时是绝对路径） */
    display?: string;
  }>;
  appPreviewVisible: (visible: boolean) => Promise<void>;
  appPreviewBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
  onAppProjectsChanged: (
    callback: (projects: import("@shared/appTypes").AppProject[]) => void
  ) => () => void;
  onAppRuntimeChanged: (
    callback: (state: import("@shared/appTypes").AppRuntimeState) => void
  ) => () => void;
  onAppLog: (callback: (line: import("@shared/appTypes").AppLogLine) => void) => () => void;
  /** 预览页加载失败（被取消的导航不算失败，不会推这个事件） */
  onAppPreviewError: (
    callback: (payload: {
      projectId?: number;
      url: string;
      message: string;
    }) => void
  ) => () => void;

  // ==================== 云端存储 ====================
  // 只管**共享数据**（发布出去的 APP 目录）。
  // 用户私有的东西（笔记、剪贴板、Todo、AI 对话）不经过这里 ——
  // 它们永远在本地 SQLite。详见 docs/CLOUD-STORAGE.md。
  cloudGetConfig: () => Promise<import("@shared/cloudTypes").CloudStorageConfig>;
  cloudSaveConfig: (payload: {
    backend?: import("@shared/cloudTypes").CloudBackend;
    d1?: import("@shared/cloudTypes").D1Config | null;
    endpoint?: string | null;
  }) => Promise<
    | { ok: true; data: import("@shared/cloudTypes").CloudStorageConfig }
    | { ok: false; error: string }
  >;
  cloudSwitchBackend: (backend: import("@shared/cloudTypes").CloudBackend) => Promise<
    | { ok: true; data: import("@shared/cloudTypes").CloudStorageConfig }
    | { ok: false; error: string }
  >;
  cloudTestConnection: (payload: {
    d1?: import("@shared/cloudTypes").D1Config;
    endpoint?: string;
  }) => Promise<import("@shared/cloudTypes").CloudConnectionStatus>;
  cloudListApps: (query?: import("@shared/cloudTypes").PublishedAppQuery) => Promise<
    | { ok: true; data: import("@shared/cloudTypes").PublishedAppListResult }
    | { ok: false; error: string }
  >;
  cloudGetApp: (id: string) => Promise<
    | { ok: true; data: import("@shared/cloudTypes").PublishedApp | null }
    | { ok: false; error: string }
  >;
  cloudPublishApp: (
    input: import("@shared/cloudTypes").PublishedAppInput,
    existingId?: string
  ) => Promise<
    | { ok: true; data: import("@shared/cloudTypes").PublishedApp }
    | { ok: false; error: string }
  >;
  cloudRemoveApp: (id: string) => Promise<
    { ok: true; data: boolean } | { ok: false; error: string }
  >;
  cloudMarkPulled: (id: string) => Promise<boolean>;
  // ==================== 主页快捷方式 ====================
  shortcutList: () => Promise<import("./components/shortcut/types").ShortcutRow[]>;
  shortcutResolveIcon: (kind: string, target: string) => Promise<string | null>;
  shortcutAdd: (input: {
    kind: import("./components/shortcut/types").ShortcutKind;
    target: string;
    title?: string;
  }) => Promise<{ success: boolean; error?: string; id?: number }>;
  shortcutUpdate: (
    id: number,
    patch: { title?: string; target?: string }
  ) => Promise<{ success: boolean; error?: string }>;
  shortcutDelete: (id: number) => Promise<boolean>;
  shortcutReorder: (ids: number[]) => Promise<boolean>;
  shortcutOpen: (id: number) => Promise<{ success: boolean; error?: string }>;
  shortcutClear: () => Promise<boolean>;
  shortcutPick: (
    kind: "app" | "folder"
  ) => Promise<import("./components/shortcut/types").ShortcutPickResult | null>;
  shortcutNormalizeTarget: (
    target: string
  ) => Promise<
    | import("./components/shortcut/types").ShortcutPickResult
    | { kind: import("./components/shortcut/types").ShortcutKind; target: string; error: string }
    | null
  >;

  // ==================== 系统右键菜单 ====================
  getShellContextMenuStatus: () => Promise<import("./components/shortcut/types").ShellMenuStatus>;
  setShellContextMenuEnabled: (
    enabled: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  /** 修复失效的右键菜单命令（菜单项在、点了没反应时用） */
  repairShellContextMenu: () => Promise<{
    success: boolean;
    repaired: boolean;
    error?: string;
  }>;
  /** 系统右键菜单唤起时收到目标路径，返回解绑函数 */
  onExternalAddShortcut: (callback: (target: string) => void) => () => void;
  /**
   * 快捷方式列表发生变化（新增 / 改名 / 删除 / 排序）
   *
   * 改表的入口不止快捷方式面板自己（剪贴板面板的「添加到快捷方式」
   * 就是另一处），面板据此刷新。
   */
  onShortcutsChanged: (callback: () => void) => () => void;


  // App info
  getAppInfo: () => Promise<{
    productName: string;
    dataPath: string;
    configPath: string;
    version: string;
    appPath: string;
    exePath: string;
  }>;

  // ============================================================
  // 应用更新
  // 类型定义在 src/renderer/types/update.ts（interface 体内不能声明 type）
  // ============================================================

  getUpdateStatus: () => Promise<import("./types/update").UpdateStatus>;
  getUpdateEnvironment: () => Promise<import("./types/update").UpdateEnvironment>;
  checkForUpdate: () => Promise<import("./types/update").UpdateStatus>;
  downloadUpdate: () => Promise<import("./types/update").UpdateStatus>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  openReleasesPage: () => Promise<boolean>;
  /** 订阅更新状态变化，返回反注册函数 */
  onUpdateStatus: (
    callback: (status: import("./types/update").UpdateStatus) => void
  ) => () => void;

  // Cross-window shared state for the floating AI assistant panel
  getFloatingAiState: () => Promise<{
    position: { right: number; bottom: number };
    expanded: boolean;
  }>;
  setFloatingAiPosition: (position: { right: number; bottom: number }) => void;
  setFloatingAiExpanded: (expanded: boolean) => void;
  onFloatingAiPositionUpdated: (
    callback: (position: { right: number; bottom: number }) => void
  ) => () => void;
  onFloatingAiExpandedUpdated: (
    callback: (expanded: boolean) => void
  ) => () => void;

  // ============================================================
  // 语音输入
  // ============================================================

  /**
   * 把一段录音送去识别
   * @param pcmBase64 Int16 单声道 PCM 的 base64（16 kHz）
   * @param sampleRate 采样率
   */
  transcribeVoiceAudio: (
    pcmBase64: string,
    sampleRate: number
  ) => Promise<{
    ok: boolean;
    text?: string;
    duration?: number;
    error?: string;
  }>;

  /** 读取当前配置的语音全局快捷键 */
  getVoiceHotkey: () => Promise<{
    ok: boolean;
    accelerator?: string;
    error?: string;
  }>;

  /**
   * 保存并注册语音全局快捷键
   * 返回值如实反映语法校验与系统注册两个环节的结果
   */
  setVoiceHotkey: (accelerator: string) => Promise<{
    ok: boolean;
    error?: string;
  }>;

  /** 监听全局语音快捷键；返回取消订阅函数 */
  onVoiceHotkeyTriggered: (callback: () => void) => () => void;

  // Window state
  onWindowMaximized: (callback: (isMaximized: boolean) => void) => () => void;

  // ==================== Popup 专用 API ====================
  // ClipboardPopup
  popupGetClipboardHistory: (limit?: number) => Promise<any[]>;
  popupCopyClipboardItem: (itemId: number) => Promise<{ success: boolean; error?: string }>;

  // 窗口控制（仅 ClipboardPopup 使用）
  closePopup: () => void;
  showMainWindow: () => void;
  /** 主进程通知面板刷新数据 */
  onPopupRefresh: (callback: () => void) => () => void;
  /** 读取剪贴板面板的展示位置 */
  getClipboardPanelPosition: () => Promise<{
    ok: boolean;
    position?: import("@shared/clipboardPanel").ClipboardPanelPosition;
    error?: string;
  }>;
  /** 保存剪贴板面板的展示位置 */
  setClipboardPanelPosition: (
    position: import("@shared/clipboardPanel").ClipboardPanelPosition
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * 读取剪贴板面板的全局快捷键
   *
   * accelerator 是**实际生效**的组合；active 表示它是否真的注册上了
   * （启动时可能被别的软件占住而没注册成功）。
   */
  getClipboardPanelHotkey: () => Promise<{
    ok: boolean;
    accelerator?: string;
    active?: boolean;
    error?: string;
  }>;
  /** 保存并注册剪贴板面板的全局快捷键；注册失败时主进程会回滚到默认组合 */
  setClipboardPanelHotkey: (
    accelerator: string
  ) => Promise<{ ok: boolean; error?: string }>;

  // ==================== 屏幕便签 API ====================
  // 把一条剪贴板记录拖出程序窗口 → 变成压在桌面上的小纸条

  /**
   * 开始一次长按
   *
   * 鼠标按下的瞬间就发过来 —— 1.2 秒的计时必须从"按下"起算。
   * 主进程按住满 1.2 秒就在光标处生成一张便签。
   */
  stickyHoldBegin: (payload: {
    type: "text" | "image";
    content: string;
  }) => void;
  /** 结束长按（松手） */
  stickyHoldEnd: () => void;
  /** 主进程让这张便签进入编辑态（右键菜单 → 编辑内容） */
  onStickyEdit: (callback: () => void) => () => void;
  /** 主进程切换了尺寸模式（右键菜单 → 自适应大小） */
  onStickyAutoSize: (callback: (enabled: boolean) => void) => () => void;
  /** 便签窗口读取自己的初始数据 */
  stickyGetInit: () => Promise<import("../shared/stickyNote").StickyNoteInit | null>;
  /** 修改便签（正文 / 置顶层级 / 尺寸模式） */
  stickyUpdate: (patch: {
    id?: string;
    text?: string;
    alwaysOnTop?: boolean;
    autoSize?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** 关掉一张便签 */
  stickyClose: (id?: string) => Promise<{ ok: boolean }>;
  /** 设置便签的位置 / 尺寸 */
  stickySetBounds: (bounds: {
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    autoSize?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** 开始移动便签（渲染层判别出拖动后调用，实际移动由主进程轮询光标完成） */
  stickyMoveBegin: (
    id?: string,
    anchor?: { x: number; y: number }
  ) => Promise<{ ok: boolean; error?: string }>;
  /** 结束移动（松手） */
  stickyMoveEnd: () => Promise<{ ok: boolean }>;
  /** 列出全部便签 */
  stickyList: () => Promise<import("../shared/stickyNote").StickyNoteInit[]>;
  /** 直接创建一张便签（菜单入口用，不必先学会拖拽） */
  stickyCreate: (payload: {
    type: "text" | "image";
    content: string;
  }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /** 弹出便签的原生右键菜单（图片便签没有常驻控件，操作走这里） */
  stickyShowMenu: () => Promise<boolean>;

  // ==================== 灵动岛 API ====================
  // 岛是独立 BrowserWindow，跑在自己的渲染层里

  /** 读灵动岛配置 */
  islandGetSettings: () => Promise<import("../shared/island").IslandSettings>;
  /** 改灵动岛配置（合并式更新），返回落库后的完整配置 */
  islandSetSettings: (
    patch: Partial<import("../shared/island").IslandSettings>
  ) => Promise<import("../shared/island").IslandSettings>;
  /** 读岛的当前状态快照 */
  islandGetState: () => Promise<import("../shared/island").IslandSnapshot>;
  /** 展开 / 收起 / 切换 */
  islandExpand: () => void;
  islandCollapse: () => void;
  islandToggle: () => void;
  /** 切页签 */
  islandSetPage: (page: import("../shared/island").IslandPage) => void;
  /** 报上收起态该有多宽（渲染层量好摘要文字后调用） */
  islandSetCollapsedWidth: (width: number) => void;
  /** 把岛放回默认位置（贴顶居中） */
  islandResetPosition: () => void;
  /**
   * 窗口要不要接收鼠标事件
   *
   * 窗口比卡片大一圈（给阴影留地方），鼠标不在卡片上时
   * 主进程把窗口设成穿透，别让那圈透明区域吃掉底下应用的点击。
   */
  islandSetInteractive: (interactive: boolean) => void;
  /** 开始拖动 —— 屏幕坐标由渲染层给（MouseEvent 带 screenX/screenY） */
  islandDragStart: (screenX: number, screenY: number) => void;
  /** 拖动中 */
  islandDragMove: (screenX: number, screenY: number) => void;
  /** 结束拖动 */
  islandDragEnd: () => void;
  /** 从岛跳回主窗口；relPath 非空表示还要打开某一篇具体笔记 */
  islandOpenMain: (payload: {
    page?: import("../shared/island").IslandPage;
    relPath?: string | null;
  }) => Promise<{ ok: boolean }>;
  /** 最近编辑的笔记 */
  islandGetRecentNotes: () => Promise<import("../shared/island").IslandRecentNote[]>;
  /** AI 任务状态快照 */
  islandGetAiActivity: () => Promise<import("../shared/island").IslandAiActivity>;
  /** 订阅岛的状态变化（展开/收起/切页） */
  onIslandState: (
    callback: (state: import("../shared/island").IslandSnapshot) => void
  ) => () => void;
  /** 订阅 AI 任务状态变化 */
  onIslandAiActivity: (
    callback: (activity: import("../shared/island").IslandAiActivity) => void
  ) => () => void;
  /** 灵动岛让主窗口跳到某个页面；relPath 非空表示还要打开某一篇具体笔记 */
  onIslandNavigate: (
    callback: (payload: { route: string; relPath: string | null }) => void
  ) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
