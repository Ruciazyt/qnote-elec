
export const CSS_TEXT_COLOR_GRAPHICS: Record<string, string> = {
  "src/renderer/components/shell/titleBar.css › .title-drag button.window-btn-minimize:hover › primary@1":
    "窗口控制按钮的最小化图标",
  "src/renderer/components/shell/titleBar.css › .title-drag button.window-btn-maximize:hover › warning@1":
    "窗口控制按钮的最大化图标",
  "src/renderer/components/shell/titleBar.css › .dark .title-drag button.window-btn-maximize:hover › warning@1":
    "窗口控制按钮的最大化图标（暗色）",
  "src/renderer/components/shell/titleBar.css › .title-drag button:last-child › foreground@0.45":
    "窗口控制按钮的关闭图标（基础态）",
  "src/renderer/components/shell/titleBar.css › .title-drag button:last-child:hover › destructive@1":
    "窗口控制按钮的关闭图标（hover）",
  "src/renderer/index.css › .search-clear-btn:hover › foreground@1":
    "搜索框清除按钮的 X 图标",
  "src/renderer/index.css › .ai-msg-copy-btn.copied › success@0.9":
    "复制按钮「已复制」状态的图标",
  "src/renderer/index.css › .ai-shortcut-hint .hint-sep › muted-foreground@0.45":
    "两个快捷键之间的分隔点，纯装饰",
  "src/renderer/index.css › .path-copy-icon › muted-foreground@0.5":
    "路径行右侧的复制图标（静止态）",
  "src/renderer/index.css › .path-copy-wrapper:hover .path-copy-icon › muted-foreground@0.75":
    "路径行复制图标（hover 显形）",
  "src/renderer/index.css › .path-copy-wrapper.copied .path-copy-icon › success@0.85":
    "复制成功的绿色勾",
  "src/renderer/index.css › .dark .path-copy-wrapper:hover .path-copy-icon › muted-foreground@0.7":
    "路径行复制图标（暗色 hover）",
};

export const CSS_TEXT_COLOR_KNOWN_VIOLATIONS: Record<string, string> = {
  "src/renderer/index.css › .ai-char-counter › muted-foreground@0.75":
    "次级文字档位过低：字符计数是文字（承载信息），压在 muted/60 底上只有 2.84，应改实心",

  "src/renderer/index.css › .lang-active-badge › primary@0.85":
    "品牌色作文字压品牌底纹：徽章底是 primary/08，品牌色二维规则下实心品牌色也不能落在品牌底纹上",

  "src/renderer/index.css › .ai-thinking-label › muted-foreground@0.7":
    "次级文字档位过低：「AI 思考中…」是文字，2.67 不过 4.5，应改实心",

  "src/renderer/index.css › .stat-number-badge › primary@0.9":
    "品牌色作文字压品牌底纹：数字徽章底是 primary/08，3.76 不过 4.5",

  "src/renderer/index.css › .ai-shortcut-hint › muted-foreground@0.7":
    "次级文字档位过低：快捷键提示是文字，压 muted/55 底只有 2.63，应改实心并挪底色",

  "src/renderer/index.css › .ai-shortcut-hint:hover › muted-foreground@0.85":
    "次级文字档位过低：hover 态压 muted/75 底 3.32，仍不过 4.5",

  "src/renderer/index.css › .dark .ai-shortcut-hint › muted-foreground@0.65":
    "次级文字档位过低：暗色态压 muted/50 底 3.01，不过 4.5",

  "src/renderer/index.css › .dark .ai-shortcut-hint:hover › muted-foreground@0.8":
    "次级文字档位过低：暗色 hover 态 3.75，不过 4.5",

  "src/renderer/index.css › .ai-shortcut-hint .hint-key › foreground@0.65":
    "键名字色偏淡：4.08 不过 4.5（真实底是父级 muted/55 底，比这里算的还差）",

  "src/renderer/index.css › .btn-delete-enabled › destructive@0.75":
    "危险色作文字压危险底纹：底是 destructive/08，2.55 不过 4.5",

  "src/renderer/index.css › .btn-delete-enabled:hover › destructive@0.95":
    "危险色作文字压危险底纹：底是 destructive/14，3.15 不过 4.5",

  "src/renderer/index.css › .dark .btn-delete-enabled › destructive@0.7":
    "危险色作文字压危险底纹：底是 destructive/12，暗色 2.33，不过 4.5",

  "src/renderer/index.css › .dark .btn-delete-enabled:hover › destructive@0.95":
    "危险色作文字压危险底纹：底是 destructive/20，暗色 2.95，不过 4.5",

  "src/renderer/styles/note-editor.css › .tiptap p.is-editor-empty:first-child::before › muted-foreground@0.55":
    "次级文字档位过低：编辑器占位提示是文字，2.10 不过 4.5，应改实心",

  "src/renderer/components/shell/titleBar.css › .title-drag button:last-child › foreground@0.45":
    "图形色未达 3:1：关闭按钮图标 2.45，图形线是 3:1",

  "src/renderer/index.css › .ai-shortcut-hint .hint-sep › muted-foreground@0.45":
    "图形色未达 3:1：分隔点 1.81（纯装饰，可考虑直接用背景色画点）",

  "src/renderer/index.css › .path-copy-icon › muted-foreground@0.5":
    "图形色未达 3:1：路径复制图标 1.95，图形线是 3:1",

  "src/renderer/index.css › .path-copy-wrapper:hover .path-copy-icon › muted-foreground@0.75":
    "图形色未达 3:1：hover 显形的复制图标 2.91，差一点到 3:1",
};
