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
  writeToFileSync: (data: string) => Promise<string>;
  getFilePath: () => Promise<string>;
  selectDirs: () => Promise<string | undefined>;
  setFilePath: (filePath: string) => Promise<void>;
  // 笔记文件（纯文件制，类型由扩展名决定；主进程是唯一写入口）
  getNoteTree: (dirPath: string) => Promise<import("../shared/noteTypes").NoteTreeNode[]>;
  /** Electron 32+ 移除了 File.path，取磁盘路径只能走这个 */
  getPathForFile: (file: File) => string;
  importNoteFiles: (
    dirPath: string,
    srcPaths: string[],
    targetFolderRel?: string
  ) => Promise<{ imported: string[]; skipped: string[] }>;
  getNoteCounts: (dirPath: string) => Promise<import("../shared/noteTypes").Record<import("../shared/noteTypes").NoteType, number>>;
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
  countFolderChildren: (dirPath: string, relPath: string) => Promise<number>;
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
  deleteNote: (content: string) => Promise<boolean>;
  deleteNoteById: (id: number) => Promise<boolean>;
  deleteAllNotes: () => Promise<{ success: boolean; deleted?: number }>;
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
  sendAiMessage: (message: string, chatSessionId?: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  // 流式 AI 调用。invoke 立即返回 sessionId，结果通过 ai-stream:* 事件推送
  sendAiMessageStream: (message: string, sessionId?: string, chatSessionId?: string) => Promise<{ sessionId: string }>;
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
  sendAiAgentStream: (
    message: string,
    sessionId?: string,
    chatSessionId?: string,
    skillId?: string | null
  ) => Promise<{ sessionId: string }>;
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
  // 工具配置
  getAiToolsConfig: () => Promise<{
    readEnabled: boolean;
    writeEnabled: boolean;
    tools: Array<{ name: string; description: string; category: 'read' | 'write' }>;
  }>;
  setAiToolsConfig: (readEnabled: boolean, writeEnabled: boolean) => Promise<{ success: boolean }>;

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
  getAiChatHistory: () => Promise<import("./components/clipboard/types").ChatMessage[]>;
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

  // Memory index
  addToMemory: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  removeFromMemory: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  memorySearch: (query: string, topK?: number) => Promise<unknown[]>;
  batchIndexMemory: () => Promise<void>;
  getMemoryCount: () => Promise<{ success: boolean; count?: number; error?: string }>;
  clearMemoryStore: () => Promise<{ success: boolean; error?: string }>;
  getMemoryStoreConfig: () => Promise<{ chromaServerUrl: string; embeddingServiceUrl: string }>;
  setMemoryStoreConfig: (chromaServerUrl: string, embeddingServiceUrl: string) => Promise<{ success: boolean; error?: string }>;

  // Vector database compatibility aliases
  addToVector: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  removeFromVector: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  vectorSearch: (query: string, topK?: number) => Promise<unknown[]>;
  batchIndexNotes: () => Promise<void>;
  getVectorCount: () => Promise<{ success: boolean; count?: number; error?: string }>;
  clearVectorStore: () => Promise<{ success: boolean; error?: string }>;
  getVectorStoreConfig: () => Promise<{ chromaServerUrl: string; embeddingServiceUrl: string }>;
  setVectorStoreConfig: (chromaServerUrl: string, embeddingServiceUrl: string) => Promise<{ success: boolean; error?: string }>;

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

  // Notifications
  onSaveNotification: (callback: (event: unknown) => void) => void;

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
  browserOpenExternal: (url: string) => Promise<boolean>;
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
  /** 系统右键菜单唤起时收到目标路径，返回解绑函数 */
  onExternalAddShortcut: (callback: (target: string) => void) => () => void;


  // App info
  getAppInfo: () => Promise<{
    productName: string;
    dataPath: string;
    configPath: string;
    version: string;
    appPath: string;
    exePath: string;
  }>;

  // Update check — fetches the latest GitHub release
  getLatestRelease: () => Promise<{
    success: boolean;
    tag?: string;
    version?: string;
    name?: string;
    htmlUrl?: string;
    publishedAt?: string;
    error?: string;
  }>;

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
  removeWindowMaximized: (callback: (isMaximized: boolean) => void) => void;

  // IPC send (generic)
  send: (channel: string, ...args: unknown[]) => void;

  // ==================== Popup 专用 API ====================
  // ClipboardPopup
  popupGetClipboardHistory: (limit?: number) => Promise<any[]>;
  popupCopyClipboardItem: (itemId: number) => Promise<{ success: boolean; error?: string }>;

  // 窗口控制（仅 ClipboardPopup 使用）
  closePopup: () => void;
  showMainWindow: () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
