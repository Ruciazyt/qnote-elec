/// <reference types="vite/client" />

interface ElectronAPI {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  openDevTools: () => void;

  onClipboardChanged: (callback: (event: unknown, data: import("./pages/home/clipboard/types").ClipboardRecord) => void) => void;
  removeClipboardChanged: (callback: (event: unknown, data: import("./pages/home/clipboard/types").ClipboardRecord) => void) => void;
  getClipboardHistory: () => Promise<import("./pages/home/clipboard/types").ClipboardRecord[]>;

  getFilePath: () => Promise<string>;
  selectDirs: () => Promise<string | undefined>;
  getNoteTree: (dirPath: string) => Promise<import("../shared/notes/noteTypes").NoteTreeNode[]>;
  getNoteTreeChildren: (
    dirPath: string,
    relDir: string
  ) => Promise<import("../shared/notes/noteTypes").NoteTreeNode[]>;
  getNoteCounts: (
    dirPath: string
  ) => Promise<Record<import("../shared/notes/noteTypes").NoteType, number>>;
  getNoteStat: (
    dirPath: string,
    relPath: string
  ) => Promise<import("../shared/notes/noteTypes").NoteFileEntry | null>;
  getExternalFolders: () => Promise<import("../shared/notes/noteTypes").ExternalFolder[]>;
  addExternalFolders: () => Promise<import("../shared/notes/noteTypes").ExternalFolder[] | null>;
  removeExternalFolder: (id: string) => Promise<import("../shared/notes/noteTypes").ExternalFolder[]>;
  getExternalTree: (id: string) => Promise<import("../shared/notes/noteTypes").NoteTreeNode[]>;
  getExternalTreeChildren: (
    id: string,
    relDir: string
  ) => Promise<import("../shared/notes/noteTypes").NoteTreeNode[]>;
  revealExternalFile: (
    id: string,
    relPath: string,
    mode?: "reveal" | "open"
  ) => Promise<boolean>;
  deleteExternalFile: (id: string, relPath: string) => Promise<boolean>;
  deleteExternalFolder: (id: string, relPath: string) => Promise<boolean>;
  renameExternalEntry: (id: string, oldRel: string, newName: string) => Promise<boolean>;
  createExternalFolder: (id: string, parentRel: string, name: string) => Promise<boolean>;
  createExternalFile: (
    id: string,
    parentRel: string,
    name: string,
    type: import("../shared/notes/noteTypes").NoteType
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
  getPathForFile: (file: File) => string;
  importNoteFiles: (
    dirPath: string,
    srcPaths: string[],
    targetFolderRel?: string
  ) => Promise<{ imported: string[]; skipped: string[] }>;
  readNote: (dirPath: string, relPath: string) => Promise<import("../shared/notes/noteTypes").NoteContent | null>;
  writeNote: (dirPath: string, relPath: string, text: string) => Promise<boolean>;
  readMarkdownNote: (dirPath: string, relPath: string) => Promise<string>;
  writeMarkdownNote: (dirPath: string, relPath: string, markdown: string) => Promise<boolean>;
  readHtmlNote: (dirPath: string, relPath: string) => Promise<string>;
  writeHtmlNote: (dirPath: string, relPath: string, html: string) => Promise<boolean>;
  onNotesChanged: (callback: (root: string) => void) => () => void;
  saveImageAsset: (dirPath: string, dataUrl: string) => Promise<string | null>;
  saveClipboardRecordAsNote: (
    dirPath: string,
    type: "text" | "image",
    content: string
  ) => Promise<import("../shared/notes/noteTypes").NoteFileEntry | null>;
  pickAndSaveImage: (dirPath: string) => Promise<{ dataUrl: string; assetRel: string } | null>;
  deleteNoteFile: (dirPath: string, relPath: string) => Promise<boolean>;
  deleteNoteFolder: (dirPath: string, relPath: string) => Promise<boolean>;
  renameNoteEntry: (dirPath: string, oldRel: string, newName: string) => Promise<boolean>;
  createNoteFolder: (dirPath: string, parentRel: string, name: string) => Promise<boolean>;
  createNoteFile: (
    dirPath: string,
    parentRel: string,
    name: string,
    type: import("../shared/notes/noteTypes").NoteType
  ) => Promise<{ ok: true; relPath: string } | { ok: false; reason: string }>;
  moveNoteEntry: (
    dirPath: string,
    fromRel: string,
    toFolderRel: string
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  openInExplorer: (dirPath: string, relPath: string) => Promise<string>;
  revealInFolder: (dirPath: string, relPath: string) => Promise<boolean>;
  saveClipboardImageNote: (dirPath: string, parentRel: string) => Promise<import("../shared/notes/noteTypes").NoteFileEntry | null>;

  baiduOcr: (imageBase64: string) => Promise<string>;
  baiduOcrAccurate: (imageBase64: string) => Promise<string>;
  baiduOcrWebImage: (imageUrl: string) => Promise<string>;
  copyImageToClipboard: (imageDataUrl: string) => Promise<void>;
  markClipboardCopied: (content: string) => Promise<boolean>;
  getBaiduKeys: () => Promise<{ apiKey: string; secretKey: string }>;
  setBaiduKeys: (apiKey: string, secretKey: string) => Promise<{ success: boolean; error?: string }>;

  searchNotes: (keyword: string) => Promise<import("./pages/home/clipboard/types").ClipboardRecord[]>;
  deleteNoteById: (id: number) => Promise<boolean>;
  deleteAllNotes: () => Promise<{ success: boolean; deleted?: number; error?: string }>;
  countProtectedNotes: () => Promise<{ kept: number; total: number; removable: number }>;
  updateNoteContent: (noteId: number, content: string) => Promise<{ success: boolean; error?: string }>;
  toggleNotePin: (noteId: number, pinned: boolean) => Promise<{ success: boolean; error?: string; pinned_at: number | null }>;
  toggleNoteImportant: (noteId: number, important: boolean) => Promise<{ success: boolean; error?: string }>;

  getTemplates: () => Promise<unknown[]>;
  saveTemplate: (template: {
    id: string;
    name: string;
    content: string;
    category: string;
    isCustom?: boolean;
  }) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

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
  previewAiSkillUrl: (url: string) => Promise<{
    success: boolean;
    skills: Array<{ name: string; content: string }>;
    rawPreview: string;
    rejected: Array<{ name: string; reason: string }>;
    error?: string;
  }>;
  importAiSkills: (skills: Array<{ name: string; content: string }>) => Promise<{
    success: boolean;
    imported?: string[];
    updated?: string[];
    skipped?: Array<{ name: string; reason: string }>;
    error?: string;
  }>;

  listBuiltinTools: () => Promise<import("../shared/ai/tools").BuiltinToolState[]>;
  setBuiltinToolEnabled: (
    name: string,
    enabled: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  getGitlabConfig: () => Promise<import("../shared/ai/tools").GitlabToolConfig>;
  saveGitlabConfig: (
    config: import("../shared/ai/tools").GitlabToolConfigInput
  ) => Promise<{ success: boolean; hasToken?: boolean; error?: string }>;
  clearGitlabConfig: () => Promise<{ success: boolean; error?: string }>;
  getGithubConfig: () => Promise<import("../shared/ai/tools").GithubToolConfig>;
  saveGithubConfig: (
    config: import("../shared/ai/tools").GithubToolConfigInput
  ) => Promise<{ success: boolean; hasToken?: boolean; error?: string }>;
  clearGithubConfig: () => Promise<{ success: boolean; error?: string }>;
  getGitlabBotConfig: () => Promise<{
    success: boolean;
    config: import("../shared/ai/gitlabBot").GitlabBotConfigView;
    status: import("../shared/ai/gitlabBot").GitlabBotStatus;
    runner: import("../shared/ai/gitlabBot").GitlabRunnerStatusView;
  }>;
  saveGitlabBotConfig: (
    config: import("../shared/ai/gitlabBot").GitlabBotConfigPayload
  ) => Promise<{
    success: boolean;
    status?: import("../shared/ai/gitlabBot").GitlabBotStatus;
    error?: string;
  }>;
  clearGitlabBotConfig: () => Promise<{
    success: boolean;
    status?: import("../shared/ai/gitlabBot").GitlabBotStatus;
    error?: string;
  }>;
  generateGitlabBotSecret: () => Promise<{
    success: boolean;
    secret?: string;
    error?: string;
  }>;
  generateGitlabBotRelayToken: () => Promise<{
    success: boolean;
    token?: string;
    error?: string;
  }>;
  revealGitlabBotRelayToken: () => Promise<{
    success: boolean;
    token?: string;
  }>;
  getGitlabBotRunnerStatus: () => Promise<{
    success: boolean;
    runner: import("../shared/ai/gitlabBot").GitlabRunnerStatusView;
  }>;
  restartGitlabBotRunner: () => Promise<{
    success: boolean;
    runner?: import("../shared/ai/gitlabBot").GitlabRunnerStatusView;
    error?: string;
  }>;

  listMcpServers: () => Promise<import("../shared/ai/mcp").McpServerState[]>;
  saveMcpServer: (server: import("../shared/ai/mcp").McpServerInput) => Promise<{
    success: boolean;
    server?: import("../shared/ai/mcp").McpServerState;
    error?: string;
  }>;
  deleteMcpServer: (id: string) => Promise<{ success: boolean; error?: string }>;
  connectMcpServer: (id: string) => Promise<{
    success: boolean;
    server?: import("../shared/ai/mcp").McpServerState;
    error?: string;
  }>;
  disconnectMcpServer: (id: string) => Promise<{
    success: boolean;
    server?: import("../shared/ai/mcp").McpServerState;
    error?: string;
  }>;
  listMcpTools: (id: string) => Promise<import("../shared/ai/mcp").McpToolInfo[]>;
  setMcpServerEnabled: (
    id: string,
    enabled: boolean
  ) => Promise<{
    success: boolean;
    server?: import("../shared/ai/mcp").McpServerState;
    error?: string;
  }>;
  getMcpProject: () => Promise<import("../shared/ai/mcp").McpProjectState>;
  pickMcpProjectDir: () => Promise<{
    success: boolean;
    canceled?: boolean;
    project?: import("../shared/ai/mcp").McpProjectState;
    error?: string;
  }>;
  setMcpProjectDir: (
    dir: string | null
  ) => Promise<{
    success: boolean;
    project?: import("../shared/ai/mcp").McpProjectState;
    error?: string;
  }>;
  reloadMcp: () => Promise<{
    success: boolean;
    servers?: import("../shared/ai/mcp").McpServerState[];
    project?: import("../shared/ai/mcp").McpProjectState;
    error?: string;
  }>;

  cancelAiMessage: (sessionId: string) => void;
  onAiStreamChunk: (
    callback: (event: unknown, payload: { sessionId: string; delta: string }) => void
  ) => () => void;
  onAiStreamThinking: (
    callback: (event: unknown, payload: { sessionId: string; delta: string }) => void
  ) => () => void;
  onAiStreamEnd: (
    callback: (event: unknown, payload: { sessionId: string; content: string }) => void
  ) => () => void;
  onAiStreamError: (
    callback: (event: unknown, payload: { sessionId: string; error: string }) => void
  ) => () => void;
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
  sendAiAgentStream: (
    message: string,
    sessionId?: string,
    chatSessionId?: string,
    skillId?: string | null,
    images?: import("@shared/ai/aiImages").AiImageAttachment[]
  ) => Promise<{ sessionId: string }>;
  pickAiImages: () => Promise<import("@shared/ai/aiImages").AiImageAttachment[]>;
  onAiStreamToolCall: (
    callback: (
      event: unknown,
      payload: {
        sessionId: string;
        id: string;
        name: string;
        title?: string;
        args: Record<string, any>;
      }
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
  getAiUsageStats: () => Promise<{
    today: import("../main/core/ai/observability/usageStats").UsageTotals;
    week: import("../main/core/ai/observability/usageStats").UsageTotals;
    all: import("../main/core/ai/observability/usageStats").UsageTotals;
    byModel: import("../main/core/ai/observability/usageStats").UsageByModel[];
    byDay: import("../main/core/ai/observability/usageStats").UsageByDay[];
    recent: import("../main/core/ai/observability/usageStats").UsageRecordRow[];
  }>;
  clearAiUsageLog: () => Promise<{ success: boolean; deleted?: number; error?: string }>;
  getAiChatSessions: () => Promise<import("./pages/ai/types").AiChatSession[]>;
  createAiChatSession: () => Promise<import("./pages/ai/types").AiChatSession>;
  getAiChatSessionHistory: (chatSessionId: string) => Promise<Array<Omit<import("./pages/ai/types").ChatMessage, "toolCalls"> & { tool_calls: import("./pages/home/clipboard/types").ToolCallRecord[] }>>;
  deleteAiChatSession: (chatSessionId: string) => Promise<boolean>;
  onAiChatChanged: (
    callback: (payload: { sessionId: string }) => void
  ) => () => void;
  clearAiChat: () => Promise<boolean>;
  getAiConfig: () => Promise<{ provider: string; apiKey: string; model: string; baseUrl: string }>;
  setAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => Promise<boolean>;
  validateAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => Promise<boolean>;
  saveOcrResult: (noteId: number, ocrResult: string) => Promise<void>;

  todoList: () => Promise<import("./pages/todo/types").Todo[]>;
  todoCreate: (input: import("./pages/todo/types").TodoInput) => Promise<import("./pages/todo/types").Todo>;
  todoUpdate: (id: number, patch: import("./pages/todo/types").TodoUpdateInput) => Promise<import("./pages/todo/types").Todo>;
  todoDelete: (id: number) => Promise<boolean>;
  todoToggle: (id: number) => Promise<import("./pages/todo/types").Todo>;
  todoArchive: (id: number) => Promise<import("./pages/todo/types").Todo>;
  todoUnarchive: (id: number) => Promise<import("./pages/todo/types").Todo>;
  onTodoReminder: (callback: (payload: import("./pages/todo/types").TodoReminderPayload) => void) => () => void;
  onTodosChanged: (callback: () => void) => () => void;

  addToMemory: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  removeFromMemory: (noteId: number) => Promise<{ success: boolean; error?: string }>;
  getMemoryCount: () => Promise<{ success: boolean; count?: number; error?: string }>;
  clearMemoryStore: () => Promise<{ success: boolean; error?: string }>;

  exportDatabase: () => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>;
  importDatabase: () => Promise<{ success: boolean; error?: string; canceled?: boolean }>;

  openExternal: (url: string) => Promise<boolean>;

  browserGetState: () => Promise<import("./pages/browser/types").BrowserState>;
  browserCreateTab: (url?: string) => Promise<import("./pages/browser/types").BrowserState>;
  browserCloseTab: (tabId: string) => Promise<import("./pages/browser/types").BrowserState>;
  browserActivateTab: (tabId: string) => Promise<import("./pages/browser/types").BrowserState>;
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
  browserBorrowSurface: () => Promise<number>;
  browserReleaseSurface: (token: number) => Promise<boolean>;
  browserReleaseAllSurfaces: () => Promise<number>;
  onBrowserTabsChanged: (
    callback: (state: import("./pages/browser/types").BrowserState) => void
  ) => () => void;
  onBrowserTabUpdated: (
    callback: (tab: import("./pages/browser/types").BrowserTabState) => void
  ) => () => void;
  onBrowserLoadError: (
    callback: (payload: import("./pages/browser/types").BrowserLoadError) => void
  ) => () => void;

  browserBookmarkList: () => Promise<import("./pages/browser/types").BookmarkRow[]>;
  browserBookmarkIsSaved: (url: string) => Promise<boolean>;
  browserBookmarkAdd: (
    url: string,
    title?: string
  ) => Promise<{ success: boolean; error?: string }>;
  browserBookmarkRemove: (url: string) => Promise<{ success: boolean; error?: string }>;
  browserBookmarkDelete: (id: number) => Promise<boolean>;
  browserBookmarkClear: () => Promise<boolean>;

  pluginList: () => Promise<import("@shared/plugin/manifest/pluginTypes").PluginRecord[]>;
  pluginImport: (dirPath: string) => Promise<import("@shared/plugin/manifest/pluginTypes").PluginImportResult>;
  pluginRemove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  pluginSetEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  pluginRefresh: () => Promise<import("@shared/plugin/manifest/pluginTypes").PluginRecord[]>;
  pluginWriteManifest: (
    pluginPath: string,
    payload: import("@shared/plugin/manifest/pluginTypes").PluginManifestDraft
  ) => Promise<{ ok: boolean; error?: string }>;
  pluginOpenFolder: (target: string) => Promise<{ ok: boolean; error?: string }>;
  pluginPickDir: () => Promise<string | null>;
  pluginStart: (
    pluginId: string,
    confirmedManifestHash?: string
  ) => Promise<{
    ok: boolean;
    error?: string;
    needsConfirmation?: import("@shared/plugin/manifest/pluginTypes").StartConfirmation;
  }>;
  pluginImportFromMarket: (
    dirPath: string,
    payload: import("@shared/plugin/manifest/pluginTypes").MarketImportPayload
  ) => Promise<import("@shared/plugin/manifest/pluginTypes").PluginImportResult>;
  pluginUpgradeFromMarket: (
    pluginId: string,
    payload: import("@shared/plugin/manifest/pluginTypes").MarketImportPayload
  ) => Promise<import("@shared/plugin/manifest/pluginTypes").PluginImportResult>;
  pluginBuildBundle: (pluginId: string) => Promise<{
    ok: boolean;
    error?: string;
    bundle?: string;
    fileCount?: number;
    bytes?: number;
    skipped?: string[];
    tooLarge?: boolean;
  }>;
  pluginStop: (id: string) => Promise<{ ok: boolean; error?: string }>;
  pluginRuntimeStates: () => Promise<import("@shared/plugin/manifest/pluginTypes").PluginRuntimeState[]>;
  pluginLogs: (pluginId: string) => Promise<import("@shared/plugin/manifest/pluginTypes").PluginLogLine[]>;
  pluginClearLogs: (pluginId: string) => Promise<boolean>;
  pluginListCommands: () => Promise<import("@shared/plugin/manifest/pluginTypes").PluginCommandEntry[]>;
  pluginListGrants: (
    pluginId: string
  ) => Promise<import("@shared/plugin/manifest/pluginTypes").PluginGrantRecord[]>;
  pluginSetGrant: (
    pluginId: string,
    capability: string,
    granted: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  pluginExecuteCommand: (command: string) => Promise<{
    ok: boolean;
    error?: string;
    needsConfirmation?: import("@shared/plugin/manifest/pluginTypes").StartConfirmation;
  }>;
  pluginGetSettings: (
    pluginId: string
  ) => Promise<import("@shared/plugin/manifest/pluginTypes").PluginSettingValue[]>;
  pluginSetSetting: (
    pluginId: string,
    key: string,
    value: unknown
  ) => Promise<{ ok: boolean; error?: string }>;
  pluginPreviewLoad: (localId: number) => Promise<{
    ok: boolean;
    error?: string;
    url?: string;
    display?: string;
  }>;
  pluginPreviewVisible: (visible: boolean) => Promise<void>;
  pluginPreviewBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
  onPluginPluginsChanged: (
    callback: (plugins: import("@shared/plugin/manifest/pluginTypes").PluginRecord[]) => void
  ) => () => void;
  onPluginRuntimeChanged: (
    callback: (state: import("@shared/plugin/manifest/pluginTypes").PluginRuntimeState) => void
  ) => () => void;
  onPluginLog: (callback: (line: import("@shared/plugin/manifest/pluginTypes").PluginLogLine) => void) => () => void;
  onPluginNotify: (
    callback: (payload: import("@shared/plugin/manifest/pluginTypes").PluginNotification) => void
  ) => () => void;
  onPluginPreviewError: (
    callback: (payload: {
      localId?: number;
      url: string;
      message: string;
    }) => void
  ) => () => void;
  onPluginPreviewLoaded: (
    callback: (payload: { localId?: number }) => void
  ) => () => void;

  dialogOpen: (context: {
    type: import("@shared/plugin/dialog/dialogTypes").DialogType;
    payload?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; error?: string }>;
  dialogGetContext: () => Promise<import("@shared/plugin/dialog/dialogTypes").DialogContext | null>;
  dialogClose: () => Promise<{ ok: boolean }>;
  dialogSend: (message: import("@shared/plugin/dialog/dialogTypes").DialogMessage) => void;
  onDialogContext: (
    callback: (context: import("@shared/plugin/dialog/dialogTypes").DialogContext) => void
  ) => () => void;
  onDialogMessage: (
    callback: (message: import("@shared/plugin/dialog/dialogTypes").DialogMessage) => void
  ) => () => void;

  cloudGetConfig: () => Promise<import("@shared/cloud/cloudTypes").CloudStorageConfig>;
  cloudSaveConfig: (payload: {
    backend?: import("@shared/cloud/cloudTypes").CloudBackend;
    catalog?: import("@shared/cloud/cloudTypes").CatalogConfig | null;
  }) => Promise<
    | { ok: true; data: import("@shared/cloud/cloudTypes").CloudStorageConfig }
    | { ok: false; error: string }
  >;
  cloudSwitchBackend: (backend: import("@shared/cloud/cloudTypes").CloudBackend) => Promise<
    | { ok: true; data: import("@shared/cloud/cloudTypes").CloudStorageConfig }
    | { ok: false; error: string }
  >;
  cloudTestConnection: (payload: {
    catalog?: import("@shared/cloud/cloudTypes").CatalogConfig;
  }) => Promise<import("@shared/cloud/cloudTypes").CloudConnectionStatus>;
  cloudListApps: (query?: import("@shared/cloud/cloudTypes").PublishedAppQuery) => Promise<
    | { ok: true; data: import("@shared/cloud/cloudTypes").PublishedAppListResult }
    | { ok: false; error: string }
  >;
  cloudGetApp: (id: string) => Promise<
    | { ok: true; data: import("@shared/cloud/cloudTypes").PublishedApp | null }
    | { ok: false; error: string }
  >;
  cloudPublishApp: (
    input: import("@shared/cloud/cloudTypes").PublishedAppInput,
    existingId?: string
  ) => Promise<
    | { ok: true; data: import("@shared/cloud/cloudTypes").PublishedApp }
    | { ok: false; error: string }
  >;
  cloudRemoveApp: (id: string) => Promise<
    { ok: true; data: boolean } | { ok: false; error: string }
  >;
  cloudMarkPulled: (id: string) => Promise<boolean>;
  shortcutList: () => Promise<import("./pages/home/shortcut/types").ShortcutRow[]>;
  shortcutResolveIcon: (kind: string, target: string) => Promise<string | null>;
  shortcutAdd: (input: {
    kind: import("./pages/home/shortcut/types").ShortcutKind;
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
    kind: import("./pages/home/shortcut/types").ShortcutKind
  ) => Promise<import("./pages/home/shortcut/types").ShortcutPickResult | null>;
  shortcutNormalizeTarget: (
    target: string
  ) => Promise<
    | import("./pages/home/shortcut/types").ShortcutPickResult
    | { kind: import("./pages/home/shortcut/types").ShortcutKind; target: string; error: string }
    | null
  >;

  getShellContextMenuStatus: () => Promise<import("./pages/home/shortcut/types").ShellMenuStatus>;
  setShellContextMenuEnabled: (
    enabled: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  repairShellContextMenu: () => Promise<{
    success: boolean;
    repaired: boolean;
    error?: string;
  }>;
  onExternalAddShortcut: (callback: (target: string) => void) => () => void;
  onShortcutsChanged: (callback: () => void) => () => void;


  getAppInfo: () => Promise<{
    productName: string;
    dataPath: string;
    configPath: string;
    version: string;
    appPath: string;
    exePath: string;
  }>;


  getUpdateStatus: () => Promise<import("./pages/settings/updateTypes").UpdateStatus>;
  getUpdateEnvironment: () => Promise<import("./pages/settings/updateTypes").UpdateEnvironment>;
  checkForUpdate: () => Promise<import("./pages/settings/updateTypes").UpdateStatus>;
  downloadUpdate: () => Promise<import("./pages/settings/updateTypes").UpdateStatus>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  openReleasesPage: () => Promise<boolean>;
  onUpdateStatus: (
    callback: (status: import("./pages/settings/updateTypes").UpdateStatus) => void
  ) => () => void;

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


  transcribeVoiceAudio: (
    pcmBase64: string,
    sampleRate: number
  ) => Promise<{
    ok: boolean;
    text?: string;
    duration?: number;
    error?: string;
  }>;

  getVoiceHotkey: () => Promise<{
    ok: boolean;
    accelerator?: string;
    error?: string;
  }>;

  setVoiceHotkey: (accelerator: string) => Promise<{
    ok: boolean;
    error?: string;
  }>;

  onVoiceHotkeyTriggered: (callback: () => void) => () => void;

  onWindowMaximized: (callback: (isMaximized: boolean) => void) => () => void;

  popupGetClipboardHistory: (limit?: number) => Promise<any[]>;
  popupCopyClipboardItem: (itemId: number) => Promise<{ success: boolean; error?: string }>;

  closePopup: () => void;
  showMainWindow: () => void;
  onPopupRefresh: (callback: () => void) => () => void;
  getClipboardPanelPosition: () => Promise<{
    ok: boolean;
    position?: import("@shared/clipboard/clipboardPanel").ClipboardPanelPosition;
    error?: string;
  }>;
  setClipboardPanelPosition: (
    position: import("@shared/clipboard/clipboardPanel").ClipboardPanelPosition
  ) => Promise<{ ok: boolean; error?: string }>;
  getClipboardPanelHotkey: () => Promise<{
    ok: boolean;
    accelerator?: string;
    active?: boolean;
    error?: string;
  }>;
  setClipboardPanelHotkey: (
    accelerator: string
  ) => Promise<{ ok: boolean; error?: string }>;


  stickyHoldBegin: (payload: {
    type: "text" | "image";
    content: string;
  }) => void;
  stickyHoldEnd: () => void;
  onStickyEdit: (callback: () => void) => () => void;
  onStickyAutoSize: (callback: (enabled: boolean) => void) => () => void;
  stickyGetInit: () => Promise<import("../shared/sticky/stickyNote").StickyNoteInit | null>;
  stickyUpdate: (patch: {
    id?: string;
    text?: string;
    alwaysOnTop?: boolean;
    autoSize?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  stickyClose: (id?: string) => Promise<{ ok: boolean }>;
  stickySetBounds: (bounds: {
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    autoSize?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  stickyMoveBegin: (
    id?: string,
    anchor?: { x: number; y: number }
  ) => Promise<{ ok: boolean; error?: string }>;
  stickyMoveEnd: () => Promise<{ ok: boolean }>;
  stickyList: () => Promise<import("../shared/sticky/stickyNote").StickyNoteInit[]>;
  stickyCreate: (payload: {
    type: "text" | "image";
    content: string;
  }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  stickyShowMenu: () => Promise<boolean>;


  islandGetSettings: () => Promise<import("../shared/island/island").IslandSettings>;
  islandSetSettings: (
    patch: Partial<import("../shared/island/island").IslandSettings>
  ) => Promise<import("../shared/island/island").IslandSettings>;
  islandGetState: () => Promise<import("../shared/island/island").IslandSnapshot>;
  islandExpand: () => void;
  islandCollapse: () => void;
  islandToggle: () => void;
  islandSetPage: (page: import("../shared/island/island").IslandPage) => void;
  islandResetPosition: () => void;
  islandSetInteractive: (interactive: boolean) => void;
  islandDragStart: (screenX: number, screenY: number) => void;
  islandDragMove: (screenX: number, screenY: number) => void;
  islandDragEnd: () => void;
  islandOpenMain: (payload: {
    page?: import("../shared/island/island").IslandPage;
    relPath?: string | null;
  }) => Promise<{ ok: boolean }>;
  islandGetRecentNotes: () => Promise<import("../shared/island/island").IslandRecentNote[]>;
  islandGetAiActivity: () => Promise<import("../shared/island/island").IslandAiActivity>;
  onIslandState: (
    callback: (state: import("../shared/island/island").IslandSnapshot) => void
  ) => () => void;
  onIslandAiActivity: (
    callback: (activity: import("../shared/island/island").IslandAiActivity) => void
  ) => () => void;
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
