const { contextBridge, ipcRenderer, webUtils } = require("electron");

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

interface TodoReminderEvent {
  id: number;
  title: string;
  notes: string | null;
  priority: string;
  remind_at: string;
}

contextBridge.exposeInMainWorld("electron", {
  minimizeWindow: () => ipcRenderer.send("minimize-window"),
  maximizeWindow: () => ipcRenderer.send("maximize-window"),
  openDevTools: () => ipcRenderer.send("open-dev-tools"),
  onClipboardChanged: (callback: any) => {
    ipcRenderer.on("clipboard-changed", callback);
  },
  removeClipboardChanged: (callback: any) => {
    ipcRenderer.removeListener("clipboard-changed", callback);
  },
  getFilePath: () => ipcRenderer.invoke("getFilePath"),
  selectDirs: () => ipcRenderer.invoke("select-dirs"),
  getClipboardHistory: () => ipcRenderer.invoke("get-clipboard-history"),
  searchNotes: (keyword: string) => ipcRenderer.invoke("search-notes", keyword),
  deleteNoteById: (id: number) => ipcRenderer.invoke("delete-note-by-id", id),
  deleteAllNotes: () => ipcRenderer.invoke("delete-all-notes"),
  countProtectedNotes: () => ipcRenderer.invoke("count-protected-notes"),
  getTemplates: () => ipcRenderer.invoke("get-templates"),
  saveTemplate: (template: { id: string, name: string, content: string, category: string, isCustom?: boolean }) =>
    ipcRenderer.invoke("save-template", template),
  deleteTemplate: (id: string) => ipcRenderer.invoke("delete-template", id),

  getAiSkills: () => ipcRenderer.invoke("get-ai-skills"),
  saveAiSkill: (skill: { id?: string; name: string; content: string }) =>
    ipcRenderer.invoke("save-ai-skill", skill),
  deleteAiSkill: (id: string) => ipcRenderer.invoke("delete-ai-skill", id),
  previewAiSkillUrl: (url: string) => ipcRenderer.invoke("preview-ai-skill-url", url),
  importAiSkills: (skills: Array<{ name: string; content: string }>) =>
    ipcRenderer.invoke("import-ai-skills", skills),

  listMcpServers: () => ipcRenderer.invoke("mcp-list-servers"),
  saveMcpServer: (server: {
    id?: string;
    name: string;
    transport: "stdio" | "http" | "sse";
    enabled?: boolean;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    timeout?: number;
  }) => ipcRenderer.invoke("mcp-save-server", server),
  deleteMcpServer: (id: string) => ipcRenderer.invoke("mcp-delete-server", id),
  connectMcpServer: (id: string) => ipcRenderer.invoke("mcp-connect-server", id),
  disconnectMcpServer: (id: string) => ipcRenderer.invoke("mcp-disconnect-server", id),
  listMcpTools: (id: string) => ipcRenderer.invoke("mcp-list-tools", id),
  setMcpServerEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke("mcp-set-server-enabled", id, enabled),
  getMcpProject: () => ipcRenderer.invoke("mcp-get-project"),
  pickMcpProjectDir: () => ipcRenderer.invoke("mcp-pick-project-dir"),
  setMcpProjectDir: (dir: string | null) =>
    ipcRenderer.invoke("mcp-set-project-dir", dir),
  reloadMcp: () => ipcRenderer.invoke("mcp-reload"),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  getNoteTree: (dirPath: string) => ipcRenderer.invoke("notes:tree", dirPath),
  getExternalFolders: () => ipcRenderer.invoke("notes:external-folders"),
  addExternalFolders: () => ipcRenderer.invoke("notes:add-external-folders"),
  removeExternalFolder: (id: string) =>
    ipcRenderer.invoke("notes:remove-external-folder", id),
  getExternalTree: (id: string) => ipcRenderer.invoke("notes:external-tree", id),
  revealExternalFile: (id: string, relPath: string, mode: "reveal" | "open" = "reveal") =>
    ipcRenderer.invoke("notes:external-reveal", id, relPath, mode),
  deleteExternalFile: (id: string, relPath: string) =>
    ipcRenderer.invoke("notes:external-delete", id, relPath),
  deleteExternalFolder: (id: string, relPath: string) =>
    ipcRenderer.invoke("notes:external-delete-folder", id, relPath),
  renameExternalEntry: (id: string, oldRel: string, newName: string) =>
    ipcRenderer.invoke("notes:external-rename", id, oldRel, newName),
  createExternalFolder: (id: string, parentRel: string, name: string) =>
    ipcRenderer.invoke("notes:external-create-folder", id, parentRel, name),
  createExternalFile: (
    id: string,
    parentRel: string,
    name: string,
    type: "excalidraw" | "markdown" | "html" | "image" | "pdf"
  ) => ipcRenderer.invoke("notes:external-create-file", id, parentRel, name, type),
  moveExternalEntry: (id: string, fromRel: string, toFolderRel: string) =>
    ipcRenderer.invoke("notes:external-move", id, fromRel, toFolderRel),
  importExternalFiles: (id: string, srcPaths: string[], targetFolderRel = "") =>
    ipcRenderer.invoke("notes:external-import-files", id, srcPaths, targetFolderRel),
  importNoteFiles: (dirPath: string, srcPaths: string[], targetFolderRel = "") =>
    ipcRenderer.invoke("notes:import-files", dirPath, srcPaths, targetFolderRel),
  readNote: (dirPath: string, relPath: string) => ipcRenderer.invoke("notes:read", dirPath, relPath),
  writeNote: (dirPath: string, relPath: string, text: string) =>
    ipcRenderer.invoke("notes:write-text", dirPath, relPath, text),
  readMarkdownNote: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:read-markdown", dirPath, relPath),
  writeMarkdownNote: (dirPath: string, relPath: string, markdown: string) =>
    ipcRenderer.invoke("notes:write-markdown", dirPath, relPath, markdown),
  readHtmlNote: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:read-html", dirPath, relPath),
  writeHtmlNote: (dirPath: string, relPath: string, html: string) =>
    ipcRenderer.invoke("notes:write-html", dirPath, relPath, html),
  onNotesChanged: (callback: (root: string) => void) => {
    const listener = (_e: unknown, root: string) => callback(root);
    ipcRenderer.on("notes:changed", listener);
    return () => ipcRenderer.removeListener("notes:changed", listener);
  },
  saveImageAsset: (dirPath: string, dataUrl: string) =>
    ipcRenderer.invoke("notes:save-asset", dirPath, dataUrl),
  saveClipboardRecordAsNote: (dirPath: string, type: "text" | "image", content: string) =>
    ipcRenderer.invoke("notes:save-from-clipboard", dirPath, type, content),
  pickAndSaveImage: (dirPath: string) => ipcRenderer.invoke("notes:pick-image", dirPath),
  deleteNoteFile: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:delete", dirPath, relPath),
  deleteNoteFolder: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:delete-folder", dirPath, relPath),
  renameNoteEntry: (dirPath: string, oldRel: string, newName: string) =>
    ipcRenderer.invoke("notes:rename", dirPath, oldRel, newName),
  createNoteFolder: (dirPath: string, parentRel: string, name: string) =>
    ipcRenderer.invoke("notes:create-folder", dirPath, parentRel, name),
  createNoteFile: (
    dirPath: string,
    parentRel: string,
    name: string,
    type: "excalidraw" | "markdown" | "html"
  ) => ipcRenderer.invoke("notes:create-file", dirPath, parentRel, name, type),
  moveNoteEntry: (dirPath: string, fromRel: string, toFolderRel: string) =>
    ipcRenderer.invoke("notes:move", dirPath, fromRel, toFolderRel),
  openInExplorer: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:open-in-explorer", dirPath, relPath),
  revealInFolder: (dirPath: string, relPath: string) =>
    ipcRenderer.invoke("notes:reveal-in-folder", dirPath, relPath),
  saveClipboardImageNote: (dirPath: string, parentRel: string) =>
    ipcRenderer.invoke("notes:save-clipboard-image", dirPath, parentRel),

  baiduOcr: (imageBase64: string) => ipcRenderer.invoke("baidu-ocr", imageBase64),
  baiduOcrAccurate: (imageBase64: string) => ipcRenderer.invoke("baidu-ocr-accurate", imageBase64),
  baiduOcrWebImage: (imageUrl: string) => ipcRenderer.invoke("baidu-ocr-webimage", imageUrl),
  copyImageToClipboard: (imageDataUrl: string) => ipcRenderer.invoke("copy-image-to-clipboard", imageDataUrl),
  markClipboardCopied: (content: string) => ipcRenderer.invoke("mark-clipboard-self-write", content),

  getBaiduKeys: () => ipcRenderer.invoke("get-baidu-keys"),
  setBaiduKeys: (apiKey: string, secretKey: string) => ipcRenderer.invoke("set-baidu-keys", apiKey, secretKey),

  onImportProgress: (callback: any) => {
    ipcRenderer.on("import-progress", callback);
  },
  removeImportProgress: (callback: any) => {
    ipcRenderer.removeListener("import-progress", callback);
  },

  getAppInfo: () => ipcRenderer.invoke("get-app-info"),

  getUpdateStatus: () => ipcRenderer.invoke("update:status"),
  getUpdateEnvironment: () => ipcRenderer.invoke("update:environment"),
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openReleasesPage: () => ipcRenderer.invoke("update:open-releases"),
  onUpdateStatus: (callback: (status: any) => void) => {
    const listener = (_e: unknown, payload: any) => callback(payload);
    ipcRenderer.on("update:status", listener);
    return () => {
      ipcRenderer.removeListener("update:status", listener);
    };
  },

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


  transcribeVoiceAudio: (pcmBase64: string, sampleRate: number): Promise<{
    ok: boolean;
    text?: string;
    duration?: number;
    error?: string;
  }> => ipcRenderer.invoke("asr:transcribe", pcmBase64, sampleRate),

  getVoiceHotkey: (): Promise<{ ok: boolean; accelerator?: string; error?: string }> =>
    ipcRenderer.invoke("voice:get-hotkey"),

  setVoiceHotkey: (
    accelerator: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("voice:set-hotkey", accelerator),

  onVoiceHotkeyTriggered: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("voice-hotkey:triggered", listener);
    return () => ipcRenderer.removeListener("voice-hotkey:triggered", listener);
  },

  getAiUsageStats: () => ipcRenderer.invoke("get-ai-usage-stats"),
  clearAiUsageLog: () => ipcRenderer.invoke("clear-ai-usage-log"),
  getAiChatSessions: () => ipcRenderer.invoke("get-ai-chat-sessions"),
  createAiChatSession: () => ipcRenderer.invoke("create-ai-chat-session"),
  getAiChatSessionHistory: (chatSessionId: string) =>
    ipcRenderer.invoke("get-ai-chat-session-history", chatSessionId),
  deleteAiChatSession: (chatSessionId: string) =>
    ipcRenderer.invoke("delete-ai-chat-session", chatSessionId),
  clearAiChat: () => ipcRenderer.invoke("clear-ai-chat"),
  getAiConfig: () => ipcRenderer.invoke("get-ai-config"),
  setAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => ipcRenderer.invoke("set-ai-config", provider, apiKey, model, baseUrl),
  validateAiConfig: (provider: string, apiKey: string, model: string, baseUrl: string) => ipcRenderer.invoke("validate-ai-config", provider, apiKey, model, baseUrl),
  saveOcrResult: (noteId: number, ocrResult: string) => ipcRenderer.invoke("save-ocr-result", noteId, ocrResult),

  updateNoteContent: (noteId: number, content: string) => ipcRenderer.invoke("update-note-content", noteId, content),

  toggleNotePin: (noteId: number, pinned: boolean) => ipcRenderer.invoke("toggle-note-pin", noteId, pinned),

  toggleNoteImportant: (noteId: number, important: boolean) =>
    ipcRenderer.invoke("toggle-note-important", noteId, important),

  todoList: () => ipcRenderer.invoke("todo:list"),
  todoCreate: (input: { title: string; notes?: string; priority?: "high" | "medium" | "low"; due_date?: string | null; remind_at?: string | null }) =>
    ipcRenderer.invoke("todo:create", input),
  todoUpdate: (id: number, patch: { title?: string; notes?: string | null; priority?: "high" | "medium" | "low"; due_date?: string | null; remind_at?: string | null }) =>
    ipcRenderer.invoke("todo:update", id, patch),
  todoDelete: (id: number) => ipcRenderer.invoke("todo:delete", id),
  todoToggle: (id: number) => ipcRenderer.invoke("todo:toggle", id),
  todoArchive: (id: number) => ipcRenderer.invoke("todo:archive", id),
  todoUnarchive: (id: number) => ipcRenderer.invoke("todo:unarchive", id),
  onTodoReminder: (callback: (payload: TodoReminderEvent) => void) => {
    const listener = (_event: unknown, payload: TodoReminderEvent) => callback(payload);
    ipcRenderer.on("todo:reminder", listener);
    return () => ipcRenderer.removeListener("todo:reminder", listener);
  },
  onTodosChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("todo:changed", listener);
    return () => ipcRenderer.removeListener("todo:changed", listener);
  },

  addToMemory: (noteId: number) => ipcRenderer.invoke("add-to-memory", noteId),
  removeFromMemory: (noteId: number) => ipcRenderer.invoke("remove-from-memory", noteId),
  getMemoryCount: () => ipcRenderer.invoke("get-memory-count"),
  clearMemoryStore: () => ipcRenderer.invoke("clear-memory-store"),

  exportDatabase: () => ipcRenderer.invoke("export-database"),
  importDatabase: () => ipcRenderer.invoke("import-database"),

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
  browserBorrowSurface: () => ipcRenderer.invoke("browser:borrow-surface"),
  browserReleaseSurface: (token: number) => ipcRenderer.invoke("browser:release-surface", token),
  browserReleaseAllSurfaces: () => ipcRenderer.invoke("browser:release-all-surfaces"),
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

  browserBookmarkList: () => ipcRenderer.invoke("bookmark:list"),
  browserBookmarkIsSaved: (url: string) => ipcRenderer.invoke("bookmark:is-saved", url),
  browserBookmarkAdd: (url: string, title?: string) =>
    ipcRenderer.invoke("bookmark:add", url, title),
  browserBookmarkRemove: (url: string) => ipcRenderer.invoke("bookmark:remove", url),
  browserBookmarkDelete: (id: number) => ipcRenderer.invoke("bookmark:delete", id),
  browserBookmarkClear: () => ipcRenderer.invoke("bookmark:clear"),

  appListProjects: () => ipcRenderer.invoke("app:list-projects"),
  appImportProject: (dirPath: string) => ipcRenderer.invoke("app:import-project", dirPath),
  appRemoveProject: (id: number) => ipcRenderer.invoke("app:remove-project", id),
  appRefreshProjects: () => ipcRenderer.invoke("app:refresh-projects"),
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
  ) => ipcRenderer.invoke("app:write-manifest", projectPath, payload),
  appOpenFolder: (target: string) => ipcRenderer.invoke("app:open-folder", target),
  appPickProjectDir: () => ipcRenderer.invoke("app:pick-project-dir"),
  appStart: (projectId: number, confirmedManifestHash?: string) =>
    ipcRenderer.invoke("app:start", projectId, confirmedManifestHash),
  appImportFromMarket: (dirPath: string, payload: unknown) =>
    ipcRenderer.invoke("app:import-from-market", dirPath, payload),
  appStop: (projectId: number) => ipcRenderer.invoke("app:stop", projectId),
  appRuntimeStates: () => ipcRenderer.invoke("app:runtime-states"),
  appLogs: (projectId: number) => ipcRenderer.invoke("app:logs", projectId),
  appClearLogs: (projectId: number) => ipcRenderer.invoke("app:clear-logs", projectId),
  appPreviewLoad: (projectId: number) =>
    ipcRenderer.invoke("app:preview-load", projectId),
  appPreviewVisible: (visible: boolean) => ipcRenderer.invoke("app:preview-visible", visible),
  appPreviewBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("app:preview-bounds", bounds),
  onAppProjectsChanged: (callback: (projects: any[]) => void) => {
    const listener = (_event: unknown, projects: any[]) => callback(projects);
    ipcRenderer.on("app:projects-changed", listener);
    return () => ipcRenderer.removeListener("app:projects-changed", listener);
  },
  onAppRuntimeChanged: (callback: (state: any) => void) => {
    const listener = (_event: unknown, state: any) => callback(state);
    ipcRenderer.on("app:runtime-changed", listener);
    return () => ipcRenderer.removeListener("app:runtime-changed", listener);
  },
  onAppLog: (callback: (line: any) => void) => {
    const listener = (_event: unknown, line: any) => callback(line);
    ipcRenderer.on("app:log", listener);
    return () => ipcRenderer.removeListener("app:log", listener);
  },
  onAppPreviewError: (callback: (payload: any) => void) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on("app:preview-error", listener);
    return () => ipcRenderer.removeListener("app:preview-error", listener);
  },

  cloudGetConfig: () => ipcRenderer.invoke("cloud:get-config"),
  cloudSaveConfig: (payload: { backend?: string; catalog?: unknown }) =>
    ipcRenderer.invoke("cloud:save-config", payload),
  cloudSwitchBackend: (backend: string) =>
    ipcRenderer.invoke("cloud:switch-backend", backend),
  cloudTestConnection: (payload: { catalog?: unknown }) =>
    ipcRenderer.invoke("cloud:test-connection", payload),
  cloudListApps: (query?: unknown) => ipcRenderer.invoke("cloud:list-apps", query),
  cloudGetApp: (id: string) => ipcRenderer.invoke("cloud:get-app", id),
  cloudPublishApp: (input: unknown, existingId?: string) =>
    ipcRenderer.invoke("cloud:publish-app", input, existingId),
  cloudRemoveApp: (id: string) => ipcRenderer.invoke("cloud:remove-app", id),
  cloudMarkPulled: (id: string) => ipcRenderer.invoke("cloud:mark-pulled", id),

  shortcutList: () => ipcRenderer.invoke("shortcut:list"),
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
  shortcutPick: (kind: string) => ipcRenderer.invoke("shortcut:pick", kind),
  shortcutNormalizeTarget: (target: string) =>
    ipcRenderer.invoke("shortcut:normalize-target", target),

  getShellContextMenuStatus: () => ipcRenderer.invoke("shell-menu:status"),
  setShellContextMenuEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("shell-menu:set", enabled),
  repairShellContextMenu: () => ipcRenderer.invoke("shell-menu:repair"),

  onExternalAddShortcut: (callback: (target: string) => void) => {
    const listener = (_event: any, target: string) => callback(target);
    ipcRenderer.on("shortcut:external-add", listener);
    return () => ipcRenderer.removeListener("shortcut:external-add", listener);
  },

  onShortcutsChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:changed", listener);
    return () => ipcRenderer.removeListener("shortcut:changed", listener);
  },

  getFloatingAiState: () => ipcRenderer.invoke("floating-ai:get-state"),
  setFloatingAiPosition: (position: { right: number; bottom: number }) =>
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

  onWindowMaximized: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: any, isMaximized: boolean) => {
      callback(isMaximized);
    };
    ipcRenderer.on("window-maximized", listener);
    return () => {
      ipcRenderer.removeListener("window-maximized", listener);
    };
  },
  popupGetClipboardHistory: (limit?: number) =>
    ipcRenderer.invoke("popup-get-clipboard-history", limit),
  popupCopyClipboardItem: (itemId: number) =>
    ipcRenderer.invoke("popup-copy-clipboard-item", itemId),

  closePopup: () => ipcRenderer.send("popup-close"),
  showMainWindow: () => ipcRenderer.send("popup-show-main-window"),

  onPopupRefresh: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("popup:refresh", listener);
    return () => ipcRenderer.removeListener("popup:refresh", listener);
  },

  getClipboardPanelPosition: (): Promise<{
    ok: boolean;
    position?: "bottom" | "side";
    error?: string;
  }> => ipcRenderer.invoke("clipboard-panel:get-position"),

  setClipboardPanelPosition: (
    position: "bottom" | "side"
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("clipboard-panel:set-position", position),

  getClipboardPanelHotkey: (): Promise<{
    ok: boolean;
    accelerator?: string;
    active?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("clipboard-panel:get-hotkey"),

  setClipboardPanelHotkey: (
    accelerator: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("clipboard-panel:set-hotkey", accelerator),


  stickyHoldBegin: (payload: { type: "text" | "image"; content: string }) =>
    ipcRenderer.send("sticky:hold-begin", payload),
  stickyHoldEnd: () => ipcRenderer.send("sticky:hold-end"),
  onStickyEdit: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("sticky:edit", listener);
    return () => {
      ipcRenderer.removeListener("sticky:edit", listener);
    };
  },
  onStickyAutoSize: (callback: (enabled: boolean) => void) => {
    const listener = (_event: unknown, enabled: boolean) => callback(enabled);
    ipcRenderer.on("sticky:autosize", listener);
    return () => {
      ipcRenderer.removeListener("sticky:autosize", listener);
    };
  },
  stickyGetInit: () => ipcRenderer.invoke("sticky:get-init"),
  stickyUpdate: (patch: {
    id?: string;
    text?: string;
    alwaysOnTop?: boolean;
    autoSize?: boolean;
  }) => ipcRenderer.invoke("sticky:update", patch),
  stickyClose: (id?: string) => ipcRenderer.invoke("sticky:close", id),
  stickySetBounds: (bounds: {
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    autoSize?: boolean;
  }) => ipcRenderer.invoke("sticky:set-bounds", bounds),
  stickyMoveBegin: (id?: string, anchor?: { x: number; y: number }) =>
    ipcRenderer.invoke("sticky:move-begin", id, anchor),
  stickyMoveEnd: () => ipcRenderer.invoke("sticky:move-end"),
  stickyList: () => ipcRenderer.invoke("sticky:list"),
  stickyCreate: (payload: { type: "text" | "image"; content: string }) =>
    ipcRenderer.invoke("sticky:create", payload),
  stickyShowMenu: () => ipcRenderer.invoke("sticky:show-menu"),


  islandGetSettings: () => ipcRenderer.invoke("island:get-settings"),
  islandSetSettings: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke("island:set-settings", patch),
  islandGetState: () => ipcRenderer.invoke("island:get-state"),
  islandExpand: () => ipcRenderer.send("island:expand"),
  islandCollapse: () => ipcRenderer.send("island:collapse"),
  islandToggle: () => ipcRenderer.send("island:toggle"),
  islandSetPage: (page: string) => ipcRenderer.send("island:set-page", page),
  islandResetPosition: () => ipcRenderer.send("island:reset-position"),
  islandSetInteractive: (interactive: boolean) =>
    ipcRenderer.send("island:set-interactive", interactive),
  islandDragStart: (screenX: number, screenY: number) =>
    ipcRenderer.send("island:drag-start", { screenX, screenY }),
  islandDragMove: (screenX: number, screenY: number) =>
    ipcRenderer.send("island:drag-move", { screenX, screenY }),
  islandDragEnd: () => ipcRenderer.send("island:drag-end"),
  islandOpenMain: (payload: { page?: string; relPath?: string | null }) =>
    ipcRenderer.invoke("island:open-main", payload),
  islandGetRecentNotes: () => ipcRenderer.invoke("island:get-recent-notes"),
  islandGetAiActivity: () => ipcRenderer.invoke("island:get-ai-activity"),
  onIslandState: (callback: (state: any) => void) => {
    const listener = (_e: unknown, state: any) => callback(state);
    ipcRenderer.on("island:state", listener);
    return () => {
      ipcRenderer.removeListener("island:state", listener);
    };
  },
  onIslandAiActivity: (callback: (activity: any) => void) => {
    const listener = (_e: unknown, activity: any) => callback(activity);
    ipcRenderer.on("island:ai-activity", listener);
    return () => {
      ipcRenderer.removeListener("island:ai-activity", listener);
    };
  },
  onIslandNavigate: (callback: (payload: { route: string; relPath: string | null }) => void) => {
    const listener = (_e: unknown, payload: { route: string; relPath: string | null }) =>
      callback(payload);
    ipcRenderer.on("island:navigate", listener);
    return () => {
      ipcRenderer.removeListener("island:navigate", listener);
    };
  },
});
