const { contextBridge, ipcRenderer, webUtils } = require("electron");

/** 内嵌浏览器单个标签页的跨进程状态 — 与主进程 BrowserTabState 严格对应 */
interface BrowserBridgeTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface BrowserBridgeState {
  tabs: BrowserBridgeTab[];
  activeTabId: string | null;
}

contextBridge.exposeInMainWorld("electron", {
  minimizeWindow: () => ipcRenderer.send("minimize-window"),
  maximizeWindow: () => ipcRenderer.send("maximize-window"),
  closeWindow: () => ipcRenderer.send("close-window"),
  openDevTools: () => ipcRenderer.send("open-dev-tools"),
  onSaveNotification: (callback: any) => {
    ipcRenderer.on("save-notification", callback);
  },
  onClipboardChanged: (callback: any) => {
    ipcRenderer.on("clipboard-changed", callback);
  },
  removeClipboardChanged: (callback: any) => {
    ipcRenderer.removeListener("clipboard-changed", callback);
  },
  writeToFileSync: (data: string) =>
    ipcRenderer.invoke("writeToFile", data),
  getFilePath: () => ipcRenderer.invoke("getFilePath"),
  selectDirs: () => ipcRenderer.invoke("select-dirs"),
  getClipboardHistory: () => ipcRenderer.invoke("get-clipboard-history"),
  searchNotes: (keyword: string) => ipcRenderer.invoke("search-notes", keyword),
  deleteNote: (content: string) => ipcRenderer.invoke("delete-note", content),
  deleteNoteById: (id: number) => ipcRenderer.invoke("delete-note-by-id", id),
  deleteAllNotes: () => ipcRenderer.invoke("delete-all-notes"),
  countProtectedNotes: () => ipcRenderer.invoke("count-protected-notes"),
  getTemplates: () => ipcRenderer.invoke("get-templates"),
  saveTemplate: (template: { id: string, name: string, content: string, category: string, isCustom?: boolean }) =>
    ipcRenderer.invoke("save-template", template),
  deleteTemplate: (id: string) => ipcRenderer.invoke("delete-template", id),

  // AI 技能（Skill）— 复用 template 表
  getAiSkills: () => ipcRenderer.invoke("get-ai-skills"),
  saveAiSkill: (skill: { id?: string; name: string; content: string }) =>
    ipcRenderer.invoke("save-ai-skill", skill),
  deleteAiSkill: (id: string) => ipcRenderer.invoke("delete-ai-skill", id),
  previewAiSkillUrl: (url: string) => ipcRenderer.invoke("preview-ai-skill-url", url),
  importAiSkills: (skills: Array<{ name: string; content: string }>) =>
    ipcRenderer.invoke("import-ai-skills", skills),
  send: (channel: string, ...args: any[]) => {
    ipcRenderer.send(channel, ...args);
  },

  // 笔记：所有类型共用一套通道，类型由扩展名决定；定位用 relPath
  /**
   * 取拖拽进来的 File 对应的磁盘路径。
   * Electron 32 起移除了 File.path，只能走 webUtils —— 直接读 file.path 会拿到 undefined。
   */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  getNoteTree: (dirPath: string) => ipcRenderer.invoke("notes:tree", dirPath),
  getNoteCounts: (dirPath: string) => ipcRenderer.invoke("notes:counts", dirPath),
  /** 从系统拖入文件：复制进笔记目录（只收笔记系统认识的类型，同名不覆盖） */
  importNoteFiles: (dirPath: string, srcPaths: string[], targetFolderRel = "") =>
    ipcRenderer.invoke("notes:import-files", dirPath, srcPaths, targetFolderRel),
  readNote: (dirPath: string, relPath: string) => ipcRenderer.invoke("notes:read", dirPath, relPath),
  writeNote: (dirPath: string, relPath: string, text: string) =>
    ipcRenderer.invoke("notes:write-text", dirPath, relPath, text),
  // 富文本 .md：主进程负责本地图片 ⇄ dataUrl 的转换，渲染层只管编辑
  readMarkdownNote: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:read-markdown", dirPath, relPath),
  writeMarkdownNote: (dirPath: string, relPath: string, markdown: string) =>
    ipcRenderer.invoke("notes:write-markdown", dirPath, relPath, markdown),
  // HTML 笔记：同样由主进程处理本地图片 ⇄ dataUrl 转换
  readHtmlNote: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:read-html", dirPath, relPath),
  writeHtmlNote: (dirPath: string, relPath: string, html: string) =>
    ipcRenderer.invoke("notes:write-html", dirPath, relPath, html),
  /**
   * 笔记目录被外部改动时收到通知（AI 写入笔记会触发）。
   * 回调收到变更的笔记根目录；笔记页据此判断是否需要重新拉取目录树。
   */
  onNotesChanged: (callback: (root: string) => void) => {
    const listener = (_e: unknown, root: string) => callback(root);
    ipcRenderer.on("notes:changed", listener);
    return () => ipcRenderer.removeListener("notes:changed", listener);
  },
  saveImageAsset: (dirPath: string, dataUrl: string) =>
    ipcRenderer.invoke("notes:save-asset", dirPath, dataUrl),
  /** 把剪贴板记录存成笔记（文本→.md，图片→.png），返回新建笔记的元数据 */
  saveClipboardRecordAsNote: (dirPath: string, type: "text" | "image", content: string) =>
    ipcRenderer.invoke("notes:save-from-clipboard", dirPath, type, content),
  pickAndSaveImage: (dirPath: string) => ipcRenderer.invoke("notes:pick-image", dirPath),
  deleteNoteFile: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:delete", dirPath, relPath),
  deleteNoteFolder: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:delete-folder", dirPath, relPath),
  countFolderChildren: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:count-children", dirPath, relPath),
  renameNoteEntry: (dirPath: string, oldRel: string, newName: string) =>
    ipcRenderer.invoke("notes:rename", dirPath, oldRel, newName),
  createNoteFolder: (dirPath: string, parentRel: string, name: string) =>
    ipcRenderer.invoke("notes:create-folder", dirPath, parentRel, name),
  /**
   * 新建一篇空白笔记，返回 { ok: true, relPath } 或 { ok: false, reason }
   * 后缀按类型决定，同名自动追加 -2 / -3，不会覆盖已有文件。
   */
  createNoteFile: (
    dirPath: string,
    parentRel: string,
    name: string,
    type: "excalidraw" | "markdown" | "html"
  ) => ipcRenderer.invoke("notes:create-file", dirPath, parentRel, name, type),
  /** 拖拽移动条目；失败时返回 { ok: false, reason } */
  moveNoteEntry: (dirPath: string, fromRel: string, toFolderRel: string) =>
    ipcRenderer.invoke("notes:move", dirPath, fromRel, toFolderRel),
  /** 在系统文件管理器中打开目录（relPath 传空串 = 笔记根目录） */
  openInExplorer: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:open-in-explorer", dirPath, relPath),
  /** 打开所在目录并高亮选中该条目 */
  revealInFolder: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:reveal-in-folder", dirPath, relPath),
  /** 把剪贴板里的图片存成一条图片笔记；剪贴板无图片时返回 null */
  saveClipboardImageNote: (dirPath: string, parentRel: string) =>
    ipcRenderer.invoke("notes:save-clipboard-image", dirPath, parentRel),

  baiduOcr: (imageBase64: string) => ipcRenderer.invoke("baidu-ocr", imageBase64),
  baiduOcrAccurate: (imageBase64: string) => ipcRenderer.invoke("baidu-ocr-accurate", imageBase64),
  baiduOcrWebImage: (imageUrl: string) => ipcRenderer.invoke("baidu-ocr-webimage", imageUrl),
  copyImageToClipboard: (imageDataUrl: string) => ipcRenderer.invoke("copy-image-to-clipboard", imageDataUrl),
  /**
   * 写剪贴板**之前**调用：告诉主进程「这条内容是应用自己复制的」。
   * 监听器据此跳过，不会把这次复制再记成一条新的剪贴板历史。
   * 顺序不能反，必须 await 之后再调 navigator.clipboard.writeText。
   */
  markClipboardCopied: (content: string) => ipcRenderer.invoke("mark-clipboard-self-write", content),

  // 配置管理API
  getBaiduKeys: () => ipcRenderer.invoke("get-baidu-keys"),
  setBaiduKeys: (apiKey: string, secretKey: string) => ipcRenderer.invoke("set-baidu-keys", apiKey, secretKey),

  // 监听导入进度
  onImportProgress: (callback: any) => {
    ipcRenderer.on("import-progress", callback);
  },
  removeImportProgress: (callback: any) => {
    ipcRenderer.removeListener("import-progress", callback);
  },

  // 应用信息API
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),

  // ============================================================
  // 应用更新
  //
  // 走主进程的 electron-updater（src/main/core/updater.ts）。
  // 之前这里只有一个 getLatestRelease —— 只查 GitHub API 拿版本号，
  // 既下载不了也装不了，而且那个 API 对非公开仓库直接 404。
  // ============================================================
  /** 拉取当前更新状态快照 */
  getUpdateStatus: () => ipcRenderer.invoke("update:status"),
  /** 运行环境信息：是否打包版 / 是否便携版 / 下载地址 */
  getUpdateEnvironment: () => ipcRenderer.invoke("update:environment"),
  /** 手动检查更新 */
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  /** 下载更新包 */
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  /** 重启并安装更新（调用后应用退出） */
  installUpdate: () => ipcRenderer.invoke("update:install"),
  /** 打开 Releases 页面（自动更新不可用时的手动出路） */
  openReleasesPage: () => ipcRenderer.invoke("update:open-releases"),
  /**
   * 订阅更新状态变化
   *
   * 下载进度这类事件是持续推送的，不能等 IPC 的返回值，所以必须走监听。
   * 返回一个反注册函数，组件卸载时调用，避免监听器泄漏导致重复 setState。
   */
  onUpdateStatus: (callback: (status: any) => void) => {
    const listener = (_e: unknown, payload: any) => callback(payload);
    ipcRenderer.on("update:status", listener);
    return () => {
      ipcRenderer.removeListener("update:status", listener);
    };
  },

  // AI相关API
  sendAiMessage: (message: string, chatSessionId?: string) =>
    ipcRenderer.invoke("send-ai-message", message, chatSessionId),
  // 流式 AI 调用。返回 { sessionId }，结果通过 ai-stream:* 事件推送
  sendAiMessageStream: (message: string, sessionId?: string, chatSessionId?: string) =>
    ipcRenderer.invoke("send-ai-message-stream", message, sessionId, chatSessionId),
  cancelAiMessage: (sessionId: string) =>
    ipcRenderer.send("cancel-ai-message", sessionId),
  onAiStreamChunk: (
    callback: (event: unknown, payload: { sessionId: string; delta: string }) => void
  ) => {
    const listener = (_e: unknown, payload: { sessionId: string; delta: string }) =>
      callback(_e, payload);
    ipcRenderer.on("ai-stream:chunk", listener);
    return () => ipcRenderer.removeListener("ai-stream:chunk", listener);
  },
  onAiStreamEnd: (
    callback: (event: unknown, payload: { sessionId: string; content: string }) => void
  ) => {
    const listener = (_e: unknown, payload: { sessionId: string; content: string }) =>
      callback(_e, payload);
    ipcRenderer.on("ai-stream:end", listener);
    return () => ipcRenderer.removeListener("ai-stream:end", listener);
  },
  onAiStreamError: (
    callback: (event: unknown, payload: { sessionId: string; error: string }) => void
  ) => {
    const listener = (_e: unknown, payload: { sessionId: string; error: string }) =>
      callback(_e, payload);
    ipcRenderer.on("ai-stream:error", listener);
    return () => ipcRenderer.removeListener("ai-stream:error", listener);
  },
  /**
   * 会话压缩进度 —— phase='compressing' 时界面应显示「正在压缩历史…」，
   * 'done' 时收起。压缩要额外调一次 LLM，不给反馈用户只会觉得界面卡住。
   */
  onAiCompacting: (
    callback: (
      event: unknown,
      payload: {
        sessionId: string;
        phase: "compressing" | "done";
        round?: number;
        maxRounds?: number;
        tokens?: number;
      }
    ) => void
  ) => {
    const listener = (
      _e: unknown,
      payload: {
        sessionId: string;
        phase: "compressing" | "done";
        round?: number;
        maxRounds?: number;
        tokens?: number;
      }
    ) => callback(_e, payload);
    ipcRenderer.on("ai-stream:compacting", listener);
    return () => ipcRenderer.removeListener("ai-stream:compacting", listener);
  },
  // Agent 模式 — 走 send-ai-agent-stream，事件复用 ai-stream:* 通道
  // skillId：选中的 AI 技能（可选，null = 不使用）
  // images：本轮带的图片附件（可选）
  //
  // 这里没有 import shared/aiImages 的类型：preload 的 tsconfig 把 rootDir
  // 锁在 src/main，引用 src/shared 下的文件会直接编译失败（TS6059）。
  // 所以这里复述一份结构 —— 字段与 AiImageAttachment 完全一致，
  // 渲染层的正式声明在 src/renderer/electron.d.ts。
  sendAiAgentStream: (
    message: string,
    sessionId?: string,
    chatSessionId?: string,
    skillId?: string | null,
    images?: { mime: string; data: string; name?: string }[]
  ) => ipcRenderer.invoke(
    "send-ai-agent-stream",
    message,
    sessionId,
    chatSessionId,
    skillId,
    images
  ),
  // 打开系统选图框，返回原始图片（base64 + mime），由渲染层缩图后再发回来
  pickAiImages: () =>
    ipcRenderer.invoke("ai:pick-images") as Promise<
      { mime: string; data: string; name?: string }[]
    >,
  onAiStreamToolCall: (
    callback: (
      event: unknown,
      payload: { sessionId: string; id: string; name: string; args: Record<string, any> }
    ) => void
  ) => {
    const listener = (
      _e: unknown,
      payload: { sessionId: string; id: string; name: string; args: Record<string, any> }
    ) => callback(_e, payload);
    ipcRenderer.on("ai-stream:tool-call", listener);
    return () => ipcRenderer.removeListener("ai-stream:tool-call", listener);
  },
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
  ) => {
    const listener = (
      _e: unknown,
      payload: {
        sessionId: string;
        id: string;
        name: string;
        result: string;
        isError: boolean;
      }
    ) => callback(_e, payload);
    ipcRenderer.on("ai-stream:tool-result", listener);
    return () => ipcRenderer.removeListener("ai-stream:tool-result", listener);
  },
  // 轮次上限：主进程问用户「是否继续」。注意这条**不发** end，
  // 渲染层的 chunk / tool-call 监听要留着等续跑那几轮
  onAiNeedContinue: (
    callback: (
      event: unknown,
      payload: { sessionId: string; rounds: number; totalRounds: number }
    ) => void
  ) => {
    const listener = (
      _e: unknown,
      payload: { sessionId: string; rounds: number; totalRounds: number }
    ) => callback(_e, payload);
    ipcRenderer.on("ai-stream:need_continue", listener);
    return () => ipcRenderer.removeListener("ai-stream:need_continue", listener);
  },
  continueAiAgent: (sessionId: string, decision: "continue" | "stop") =>
    ipcRenderer.invoke("ai-continue-agent", sessionId, decision),

  // ============================================================
  // 语音输入
  // ============================================================
  //
  // 音频以 base64 字符串过桥，而不是 Uint8Array：
  // contextBridge 对 TypedArray 的传递并不保证保真（会被拆成普通对象），
  // 而 base64 是纯字符串，任何情况下都能原样送达主进程。

  /**
   * 把一段录音送去识别
   *
   * @param pcmBase64  Int16 单声道 PCM 的 base64（16 kHz）
   * @param sampleRate 采样率
   * @returns 成功时 { ok:true, text, duration }；失败时 { ok:false, error }
   */
  transcribeVoiceAudio: (pcmBase64: string, sampleRate: number): Promise<{
    ok: boolean;
    text?: string;
    duration?: number;
    error?: string;
  }> => ipcRenderer.invoke("asr:transcribe", pcmBase64, sampleRate),

  /** 读取当前配置的语音全局快捷键 */
  getVoiceHotkey: (): Promise<{ ok: boolean; accelerator?: string; error?: string }> =>
    ipcRenderer.invoke("voice:get-hotkey"),

  /**
   * 保存并注册语音全局快捷键
   *
   * 返回值如实反映两件事：语法是否合法、系统热键是否真的注册成功。
   * 失败时主进程会回滚到默认组合，不会留下"存了但不生效"的配置。
   */
  setVoiceHotkey: (
    accelerator: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("voice:set-hotkey", accelerator),

  /** 监听全局语音快捷键（收起为宠物时由主进程下发） */
  onVoiceHotkeyTriggered: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("voice-hotkey:triggered", listener);
    return () => ipcRenderer.removeListener("voice-hotkey:triggered", listener);
  },

  // AI 用量统计（设置页可视化）
  getAiUsageStats: () => ipcRenderer.invoke("get-ai-usage-stats"),
  clearAiUsageLog: () => ipcRenderer.invoke("clear-ai-usage-log"),
  getAiChatSessions: () => ipcRenderer.invoke("get-ai-chat-sessions"),
  createAiChatSession: () => ipcRenderer.invoke("create-ai-chat-session"),
  getAiChatSessionHistory: (chatSessionId: string) =>
    ipcRenderer.invoke("get-ai-chat-session-history", chatSessionId),
  deleteAiChatSession: (chatSessionId: string) =>
    ipcRenderer.invoke("delete-ai-chat-session", chatSessionId),
  getAiChatHistory: () => ipcRenderer.invoke("get-ai-chat-history"),
  clearAiChat: () => ipcRenderer.invoke("clear-ai-chat"),
  getAiConfig: () => ipcRenderer.invoke("get-ai-config"),
  setAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => ipcRenderer.invoke("set-ai-config", provider, apiKey, model, baseUrl),
  validateAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => ipcRenderer.invoke("validate-ai-config", provider, apiKey, model, baseUrl),
  saveOcrResult: (noteId: number, ocrResult: string) => ipcRenderer.invoke("save-ocr-result", noteId, ocrResult),

  // 代码格式化API
  updateNoteContent: (noteId: number, content: string) => ipcRenderer.invoke("update-note-content", noteId, content),

  // 置顶 API
  toggleNotePin: (noteId: number, pinned: boolean) => ipcRenderer.invoke("toggle-note-pin", noteId, pinned),

  // 重要标记 API（清空记录时会被跳过）
  toggleNoteImportant: (noteId: number, important: boolean) =>
    ipcRenderer.invoke("toggle-note-important", noteId, important),

  // Todo API
  todoList: () => ipcRenderer.invoke("todo:list"),
  todoCreate: (input: { title: string; notes?: string; priority?: "high" | "medium" | "low"; due_date?: string | null }) =>
    ipcRenderer.invoke("todo:create", input),
  todoUpdate: (id: number, patch: { title?: string; notes?: string | null; priority?: "high" | "medium" | "low"; due_date?: string | null }) =>
    ipcRenderer.invoke("todo:update", id, patch),
  todoDelete: (id: number) => ipcRenderer.invoke("todo:delete", id),
  todoToggle: (id: number) => ipcRenderer.invoke("todo:toggle", id),

  // 本地记忆索引 API
  addToMemory: (noteId: number) => ipcRenderer.invoke("add-to-memory", noteId),
  removeFromMemory: (noteId: number) => ipcRenderer.invoke("remove-from-memory", noteId),
  memorySearch: (query: string, topK?: number) => ipcRenderer.invoke("memory-search", query, topK || 5),
  batchIndexMemory: () => ipcRenderer.invoke("batch-index-memory"),
  getMemoryCount: () => ipcRenderer.invoke("get-memory-count"),
  clearMemoryStore: () => ipcRenderer.invoke("clear-memory-store"),
  getMemoryStoreConfig: () => ipcRenderer.invoke("get-memory-store-config"),
  setMemoryStoreConfig: (chromaServerUrl: string, embeddingServiceUrl: string) => ipcRenderer.invoke("set-memory-store-config", chromaServerUrl, embeddingServiceUrl),

  // 兼容旧的向量命名 API
  addToVector: (noteId: number) => ipcRenderer.invoke("add-to-memory", noteId),
  removeFromVector: (noteId: number) => ipcRenderer.invoke("remove-from-memory", noteId),
  vectorSearch: (query: string, topK?: number) => ipcRenderer.invoke("memory-search", query, topK || 5),
  batchIndexNotes: () => ipcRenderer.invoke("batch-index-memory"),
  getVectorCount: () => ipcRenderer.invoke("get-memory-count"),
  clearVectorStore: () => ipcRenderer.invoke("clear-memory-store"),
  getVectorStoreConfig: () => ipcRenderer.invoke("get-memory-store-config"),
  setVectorStoreConfig: (chromaServerUrl: string, embeddingServiceUrl: string) => ipcRenderer.invoke("set-memory-store-config", chromaServerUrl, embeddingServiceUrl),

  // 数据迁移
  exportDatabase: () => ipcRenderer.invoke("export-database"),
  importDatabase: () => ipcRenderer.invoke("import-database"),

  // 题单相关API
  getLeetcodeCollections: () => ipcRenderer.invoke("get-leetcode-collections"),
  getLeetcodeCollection: (id: number) => ipcRenderer.invoke("get-leetcode-collection", id),
  saveLeetcodeCollection: (collection: { id?: number; name: string; summary: string; problems?: Array<{ id?: number; link: string; is_completed: boolean; title?: string; difficulty?: string }> }) =>
    ipcRenderer.invoke("save-leetcode-collection", collection),
  deleteLeetcodeCollection: (id: number) => ipcRenderer.invoke("delete-leetcode-collection", id),
  updateLeetcodeProblem: (problemId: number, updates: { link?: string; is_completed?: boolean; difficulty?: string }) =>
    ipcRenderer.invoke("update-leetcode-problem", problemId, updates),
  getLeetcodeProblemTitle: (url: string) => ipcRenderer.invoke("get-leetcode-problem-title", url),
  importLeetcodeCollection: (text: string) => ipcRenderer.invoke("import-leetcode-collection", text),

  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),

  // ==================== 内嵌浏览器 API ====================
  // 真正的网页内容由主进程的 WebContentsView 承载，渲染进程只负责工具栏 UI + 同步位置
  browserGetState: () => ipcRenderer.invoke("browser:get-state"),
  browserCreateTab: (url?: string) => ipcRenderer.invoke("browser:create-tab", url),
  browserCloseTab: (tabId: string) => ipcRenderer.invoke("browser:close-tab", tabId),
  browserActivateTab: (tabId: string) => ipcRenderer.invoke("browser:activate-tab", tabId),
  browserLoadUrl: (tabId: string, url: string) =>
    ipcRenderer.invoke("browser:load-url", tabId, url),
  browserNavigate: (tabId: string, action: "back" | "forward" | "reload" | "stop") =>
    ipcRenderer.invoke("browser:navigate", tabId, action),
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("browser:set-bounds", bounds),
  browserSetVisible: (visible: boolean) => ipcRenderer.invoke("browser:set-visible", visible),
  // 表层借出：让渲染层浮层能盖在网页之上。归还靠 token，显式调用 release。
  browserBorrowSurface: () => ipcRenderer.invoke("browser:borrow-surface"),
  browserReleaseSurface: (token: number) => ipcRenderer.invoke("browser:release-surface", token),
  browserReleaseAllSurfaces: () => ipcRenderer.invoke("browser:release-all-surfaces"),
  browserOpenExternal: (url: string) => ipcRenderer.invoke("browser:open-external", url),
  onBrowserTabsChanged: (callback: (state: BrowserBridgeState) => void) => {
    const listener = (_event: unknown, state: BrowserBridgeState) => callback(state);
    ipcRenderer.on("browser:tabs-changed", listener);
    return () => ipcRenderer.removeListener("browser:tabs-changed", listener);
  },
  onBrowserTabUpdated: (callback: (tab: BrowserBridgeTab) => void) => {
    const listener = (_event: unknown, tab: BrowserBridgeTab) => callback(tab);
    ipcRenderer.on("browser:tab-updated", listener);
    return () => ipcRenderer.removeListener("browser:tab-updated", listener);
  },
  onBrowserLoadError: (
    callback: (payload: { tabId: string; url: string; errorCode: number; errorDescription: string }) => void
  ) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on("browser:load-error", listener);
    return () => ipcRenderer.removeListener("browser:load-error", listener);
  },

  // ==================== 浏览器收藏 API ====================
  browserBookmarkList: () => ipcRenderer.invoke("bookmark:list"),
  browserBookmarkIsSaved: (url: string) => ipcRenderer.invoke("bookmark:is-saved", url),
  browserBookmarkAdd: (url: string, title?: string) =>
    ipcRenderer.invoke("bookmark:add", url, title),
  browserBookmarkRemove: (url: string) => ipcRenderer.invoke("bookmark:remove", url),
  browserBookmarkDelete: (id: number) => ipcRenderer.invoke("bookmark:delete", id),
  browserBookmarkClear: () => ipcRenderer.invoke("bookmark:clear"),

  // ==================== 主页快捷方式 API ====================
  shortcutList: () => ipcRenderer.invoke("shortcut:list"),
  /** 解析单个图标，返回 data URL；取不到返回 null。逐个调用，慢的那个不拖累快的 */
  shortcutResolveIcon: (kind: string, target: string) =>
    ipcRenderer.invoke("shortcut:resolve-icon", kind, target),
  shortcutAdd: (input: { kind: string; target: string; title?: string }) =>
    ipcRenderer.invoke("shortcut:add", input),
  shortcutUpdate: (id: number, patch: { title?: string; target?: string }) =>
    ipcRenderer.invoke("shortcut:update", id, patch),
  shortcutDelete: (id: number) => ipcRenderer.invoke("shortcut:delete", id),
  shortcutReorder: (ids: number[]) => ipcRenderer.invoke("shortcut:reorder", ids),
  shortcutOpen: (id: number) => ipcRenderer.invoke("shortcut:open", id),
  shortcutClear: () => ipcRenderer.invoke("shortcut:clear"),
  /** 打开系统选择器；kind 为 'app' | 'folder'，用户取消返回 null */
  shortcutPick: (kind: string) => ipcRenderer.invoke("shortcut:pick", kind),
  /** 把裸路径/URL 归一化成快捷方式输入（系统右键菜单唤起时用） */
  shortcutNormalizeTarget: (target: string) =>
    ipcRenderer.invoke("shortcut:normalize-target", target),

  /** 系统右键菜单项 */
  getShellContextMenuStatus: () => ipcRenderer.invoke("shell-menu:status"),
  setShellContextMenuEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("shell-menu:set", enabled),
  /** 修复失效的右键菜单命令（菜单项在、点了没反应时用） */
  repairShellContextMenu: () => ipcRenderer.invoke("shell-menu:repair"),

  /**
   * 从系统右键菜单「添加到 QNote 快捷方式」唤起时收到目标路径
   *
   * 返回取消函数而不是要求调用方再 removeListener：回调是每次新建的
   * 包装函数，按引用 removeListener 匹配不上，等于永远解绑不掉。
   */
  onExternalAddShortcut: (callback: (target: string) => void) => {
    const listener = (_event: any, target: string) => callback(target);
    ipcRenderer.on("shortcut:external-add", listener);
    return () => ipcRenderer.removeListener("shortcut:external-add", listener);
  },

  /**
   * 快捷方式列表发生变化（新增 / 改名 / 删除 / 排序）
   *
   * 改这张表的入口不止快捷方式面板自己 —— 剪贴板面板的「添加到快捷方式」
   * 就是从面板之外改的。面板收到广播后重新拉一次列表，否则那条快捷方式
   * 要等下次进主页才看得见。
   */
  onShortcutsChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:changed", listener);
    return () => ipcRenderer.removeListener("shortcut:changed", listener);
  },

  // 跨窗口 AI 浮框位置 / 展开同步
  getFloatingAiState: () => ipcRenderer.invoke("floating-ai:get-state"),  setFloatingAiPosition: (position: { right: number; bottom: number }) =>
    ipcRenderer.send("floating-ai:set-position", position),
  setFloatingAiExpanded: (expanded: boolean) =>
    ipcRenderer.send("floating-ai:set-expanded", expanded),
  onFloatingAiPositionUpdated: (
    callback: (position: { right: number; bottom: number }) => void
  ) => {
    const listener = (_event: unknown, position: { right: number; bottom: number }) =>
      callback(position);
    ipcRenderer.on("floating-ai:position-updated", listener);
    return () => ipcRenderer.removeListener("floating-ai:position-updated", listener);
  },
  onFloatingAiExpandedUpdated: (callback: (expanded: boolean) => void) => {
    const listener = (_event: unknown, expanded: boolean) => callback(expanded);
    ipcRenderer.on("floating-ai:expanded-updated", listener);
    return () => ipcRenderer.removeListener("floating-ai:expanded-updated", listener);
  },

  // 窗口状态监听
  onWindowMaximized: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: any, isMaximized: boolean) => {
      callback(isMaximized);
    };
    ipcRenderer.on("window-maximized", listener);
    return () => {
      ipcRenderer.removeListener("window-maximized", listener);
    };
  },
  removeWindowMaximized: (callback: any) => {
    ipcRenderer.removeListener("window-maximized", callback);
  },

  // ==================== Popup 专用 API ====================
  // ClipboardPopup
  popupGetClipboardHistory: (limit?: number) =>
    ipcRenderer.invoke("popup-get-clipboard-history", limit),
  popupCopyClipboardItem: (itemId: number) =>
    ipcRenderer.invoke("popup-copy-clipboard-item", itemId),

  // 窗口控制（现在仅 ClipboardPopup 使用 — AI Popup 已移除）
  closePopup: () => ipcRenderer.send("popup-close"),
  showMainWindow: () => ipcRenderer.send("popup-show-main-window"),

  // ==================== 屏幕便签 API ====================
  // 把一条剪贴板记录拖出程序窗口 → 变成压在桌面上的小纸条

  /**
   * 开始一次长按
   *
   * 鼠标按下的瞬间就发过来 —— 1.2 秒的计时必须从"按下"起算。
   * 主进程按住满 1.2 秒就在光标处生成一张便签。
   */
  stickyHoldBegin: (payload: { type: "text" | "image"; content: string }) =>
    ipcRenderer.send("sticky:hold-begin", payload),
  /** 结束长按（松手） */
  stickyHoldEnd: () => ipcRenderer.send("sticky:hold-end"),
  /** 主进程让这张便签进入编辑态（右键菜单 → 编辑内容） */
  onStickyEdit: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("sticky:edit", listener);
    return () => {
      ipcRenderer.removeListener("sticky:edit", listener);
    };
  },
  /**
   * 主进程切换了尺寸模式（右键菜单 → 自适应大小）
   *
   * 参数为 true 时，渲染层要重新量一次正文，把窗口缩到正好包住内容。
   */
  onStickyAutoSize: (callback: (enabled: boolean) => void) => {
    const listener = (_event: unknown, enabled: boolean) => callback(enabled);
    ipcRenderer.on("sticky:autosize", listener);
    return () => {
      ipcRenderer.removeListener("sticky:autosize", listener);
    };
  },
  /** 便签窗口读取自己的初始数据 */
  stickyGetInit: () => ipcRenderer.invoke("sticky:get-init"),
  /** 修改便签（正文 / 置顶层级 / 尺寸模式） */
  stickyUpdate: (patch: {
    id?: string;
    text?: string;
    alwaysOnTop?: boolean;
    autoSize?: boolean;
  }) => ipcRenderer.invoke("sticky:update", patch),
  /** 关掉一张便签 */
  stickyClose: (id?: string) => ipcRenderer.invoke("sticky:close", id),
  /** 设置便签的位置 / 尺寸（自定义缩放手柄用） */
  stickySetBounds: (bounds: {
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    autoSize?: boolean;
  }) => ipcRenderer.invoke("sticky:set-bounds", bounds),
  /**
   * 开始移动便签
   *
   * 渲染层判别出"用户在拖动"后调用，之后由主进程轮询光标移动窗口。
   * anchor 是按下鼠标那一点在窗口内的位置 —— 抓住哪儿便签就跟到哪儿。
   */
  stickyMoveBegin: (id?: string, anchor?: { x: number; y: number }) =>
    ipcRenderer.invoke("sticky:move-begin", id, anchor),
  /** 结束移动（松手） */
  stickyMoveEnd: () => ipcRenderer.invoke("sticky:move-end"),
  /** 列出全部便签 */
  stickyList: () => ipcRenderer.invoke("sticky:list"),
  /** 直接创建一张便签（菜单入口用，不必先学会拖拽） */
  stickyCreate: (payload: { type: "text" | "image"; content: string }) =>
    ipcRenderer.invoke("sticky:create", payload),
  /** 弹出便签的原生右键菜单（图片便签没有常驻控件，操作走这里） */
  stickyShowMenu: () => ipcRenderer.invoke("sticky:show-menu"),
});
