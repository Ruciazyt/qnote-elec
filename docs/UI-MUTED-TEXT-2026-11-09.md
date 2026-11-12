# 次级文字透明度档全量清单（2026-11-09）

生成器：`scripts/audit-muted-text.mjs`（跑一次就能重出这份清单，别手抄）。
对比度口径见 `docs/UI-GUIDELINES.md` 第九节，与 `scripts/check-contrast.mjs` 同一套算法。

## 判定规则（2026-11-09 Chief 裁决）

- 承载信息的**文字** → 实心 `text-muted-foreground`。light 4.61 / dark 5.65（取更差列）。
- **图形**（图标）→ 至少 `/85`。light 3.47 / dark 4.46，图形 3:1 线两边都过。
- 现状**低于 3:1** 的（/25 /30 /40 /45 /50 /55 /60 /65 /70 /75）没有例外，必改。
- light 侧文字只有实心一条路 —— 最高的 `/95` 也只有 4.19，不过正文线 4.5。
- 悬停显形（`/0` → hover 档）：文字改实心，箭头/图标改 `/85`。
- 实心值压在 `bg-muted` 底上 light 只有 4.20（不过 AA）→ 这几处底色要一起挪开，别只改字色。

## 汇总

- 合计 **132 处**（Tailwind 121 / CSS 11）。
- 文字 **104 处** → 全部改实心；图形 **28 处** → 全部改 `/85`。
- 不过 3:1 图形线 **110 处**（含 2 处 `/0` 悬停起始态，本来就是透明的）。
- 改实心后要连底色一起挪开的 **3 处**：压 `bg-muted` 底的文字。

## 分文件清单

每行：行号 · 现状档位 · light/dark 对比度 · 类型 · 底色 · 目标。

### src/renderer/App.tsx

- 91 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）

### src/renderer/components/apps/AppLogConsole.tsx

- 119 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/apps/AppPreviewPane.tsx

- 188 · `/30` · light 1.46 / dark 1.65 · 图形 · 装饰图形 · 底 bg-background → text-muted-foreground/85（现状不过 3:1，必改）
- 189 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-background → text-muted-foreground（实心）
- 190 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 bg-background → text-muted-foreground（实心）

### src/renderer/components/apps/AppProjectHeader.tsx

- 187 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 203 · `/85` · light 3.47 / dark 4.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 206 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 213 · `/70` · light 2.67 / dark 3.46 · 图形 · 交互图标（复制地址按钮，内含图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 225 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/apps/AppProjectList.tsx

- 72 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 90 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）

### src/renderer/components/apps/ManifestDialog.tsx

- 203 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 228 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/apps/RemoveProjectDialog.tsx

- 54 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）

### src/renderer/components/browser/BookmarkList.tsx

- 100 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 106 · `/30` · light 1.46 / dark 1.65 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 107 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 111 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 149 · `/0` · light 1 / dark 1 · 图形 · 交互图标（悬停显形按钮图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 149 · `/70` · light 2.67 / dark 3.46 · 图形 · 交互图标（悬停显形按钮图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 157 · `/0` · light 1 / dark 1 · 图形 · 交互图标（悬停显形按钮图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 157 · `/70` · light 2.67 / dark 3.46 · 图形 · 交互图标（悬停显形按钮图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）

### src/renderer/components/clipboard/AiChatPanel.tsx

- 194 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 409 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）　← 实心压这底只有 4.20，底要挪
- 427 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 552 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 694 · `/70` · light 2.67 / dark 3.46 · 图形 · 装饰图形 · 底 bg-muted → text-muted-foreground/85（现状不过 3:1，必改）
- 703 · `/70` · light 2.67 / dark 3.46 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）

### src/renderer/components/clipboard/AiComposer.tsx

- 498 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 bg-muted → text-muted-foreground（实心）　← 实心压这底只有 4.20，底要挪

### src/renderer/components/clipboard/ClipboardList.tsx

- 450 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 664 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 668 · `/50` · light 1.95 / dark 2.41 · 图形 · 交互图标 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 668 · `/80` · light 3.18 / dark 4.11 · 图形 · 交互图标 · 底 未写明 → text-muted-foreground/85
- 994 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 1089 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1089 · `/75` · light 2.91 / dark 3.78 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/clipboard/ClipboardPopup.tsx

- 303 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 363 · `/40` · light 1.68 / dark 2 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 365 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/clipboard/ClipboardToolbar.tsx

- 122 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-muted → text-muted-foreground（实心）

### src/renderer/components/clipboard/ImageOcrDialog.tsx

- 169 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 195 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）

### src/renderer/components/core/FloatingAiAssistant.tsx

- 981 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/core/PetSpeechBubble.tsx

- 149 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 159 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/core/settings-card.tsx

- 44 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）　← 实心压这底只有 4.20，底要挪
- 122 · `/75` · light 2.91 / dark 3.78 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/core/settings.tsx

- 255 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 337 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 389 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 994 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 1299 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 1310 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1350 · `/75` · light 2.91 / dark 3.78 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 1353 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 1371 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 1411 · `/75` · light 2.91 / dark 3.78 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 1420 · `/75` · light 2.91 / dark 3.78 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 1435 · `/65` · light 2.46 / dark 3.17 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1458 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1478 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1489 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1550 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1576 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1590 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1713 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 1796 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1914 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 1940 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 2099 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 2129 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 2194 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/core/UpdateCard.tsx

- 288 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 359 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/Leetcode/SideBar.tsx

- 495 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 612 · `/90` · light 3.81 / dark 4.84 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/Note/editors/HtmlViewer.tsx

- 110 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形（空态容器，只包图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）

### src/renderer/components/Note/editors/ImageViewer.tsx

- 64 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形（空态容器，只包图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 82 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/Note/editors/PdfViewer.tsx

- 74 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形（空态容器，只包图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 92 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 139 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/Note/NoteFileList.tsx

- 402 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 413 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 466 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 470 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 480 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 550 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-background → text-muted-foreground（实心）
- 581 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-accent → text-muted-foreground（实心）

### src/renderer/components/shortcut/AddShortcutDialog.tsx

- 247 · `/70` · light 2.67 / dark 3.46 · 图形 · 装饰图形 · 底 bg-muted → text-muted-foreground/85（现状不过 3:1，必改）
- 258 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/shortcut/ShortcutPanel.tsx

- 634 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 668 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 678 · `/25` · light 1.37 / dark 1.5 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 679 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 680 · `/45` · light 1.81 / dark 2.2 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/components/shortcut/ShortcutTile.tsx

- 82 · `/70` · light 2.67 / dark 3.46 · 图形 · 装饰图形（应用图标） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）

### src/renderer/components/todo/TodoEditDialog.tsx

- 250 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 306 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）

### src/renderer/components/todo/TodoList.tsx

- 80 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）

### src/renderer/index.css

- 990 · `/75` · light 2.91 / dark 3.78 · 文字 · 底 muted / 0.6 → text-muted-foreground（实心）
- 1490 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 2224 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 muted / 0.55 → text-muted-foreground（实心）
- 2233 · `/85` · light 3.47 / dark 4.46 · 文字 · 底 muted / 0.75 → text-muted-foreground（实心）
- 2239 · `/65` · light 2.46 / dark 3.17 · 文字 · 底 muted / 0.5 → text-muted-foreground（实心）
- 2244 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 muted / 0.65 → text-muted-foreground（实心）
- 2260 · `/45` · light 1.81 / dark 2.2 · 图形 · 装饰图形（快捷键之间的分隔点，纯装饰） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 2494 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形（复制图标，hover 显形） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 2509 · `/75` · light 2.91 / dark 3.78 · 图形 · 装饰图形（复制图标 hover 态） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 2530 · `/70` · light 2.67 / dark 3.46 · 图形 · 装饰图形（复制图标 hover 态（暗色）） · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）

### src/renderer/pages/AppsPage.tsx

- 422 · `/70` · light 2.67 / dark 3.46 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 492 · `/25` · light 1.37 / dark 1.5 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 493 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 496 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 540 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/pages/HomePage.tsx

- 632 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 637 · `/25` · light 1.37 / dark 1.5 · 文字（「粘贴内容」文字 + currentColor 箭头） · 底 未写明 → text-muted-foreground（实心）
- 646 · `/40` · light 1.68 / dark 2 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 648 · `/50` · light 1.95 / dark 2.41 · 文字 · 底 未写明 → text-muted-foreground（实心）

### src/renderer/pages/NotesPage.tsx

- 108 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 1344 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-card → text-muted-foreground（实心）

### src/renderer/pages/SkillsPage.tsx

- 245 · `/75` · light 2.91 / dark 3.78 · 文字 · 底 bg-primary → text-muted-foreground（实心）
- 272 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形 · 底 未写明 → text-muted-foreground/85（现状不过 3:1，必改）
- 289 · `/50` · light 1.95 / dark 2.41 · 图形 · 装饰图形 · 底 bg-muted → text-muted-foreground/85（现状不过 3:1，必改）
- 291 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 294 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 314 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 318 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 bg-muted → text-muted-foreground（实心）
- 408 · `/70` · light 2.67 / dark 3.46 · 文字 · 底 未写明 → text-muted-foreground（实心）
- 419 · `/80` · light 3.18 / dark 4.11 · 文字 · 底 bg-muted → text-muted-foreground（实心）

### src/renderer/styles/note-editor.css

- 32 · `/55` · light 2.1 / dark 2.65 · 文字 · 底 未写明 → text-muted-foreground（实心）
