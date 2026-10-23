# QA 报告：QNote 快捷功能实现验证

**工程师**：Claw（QA 子代理）  
**日期**：2026-03-27  
**项目路径**：`/home/zyt/.openclaw/workspace/qnote-elec`  
**验证分支**：现有实现（对应 `team/pm/shortcut_spec.md` 和 `team/architect/shortcut_plan.md`）

---

## 一、构建验证

| 步骤 | 命令 | 结果 |
|------|------|------|
| `npm run build:main` | tsc -p build/tsconfig.main.json | ✅ 通过 |
| `npm run build:preload` | tsc -p build/tsconfig.preload.json | ✅ 通过 |
| `npm run build:react` | vite build | ✅ 通过（有 chunk size 警告，见下文） |

**问题**：React 构建产生超大 chunk（`index-8NTEMKi1.js` 2.96 MB），Mermaid 相关 chunk（`flowchart-elk-definition` 1.4 MB、`subset-shared.chunk` 1.8 MB）过大，非本次快捷功能范围但影响性能，建议后续拆分。

---

## 二、文件存在性检查

| 文件 | 规格 | 实际 | 状态 |
|------|------|------|------|
| `src/main/core/shortcuts.ts` | 必须 | 39 行 | ✅ |
| `src/main/core/window/clipboardPopup.ts` | 必须 | 104 行 | ✅ |
| `src/main/core/window/aiPopup.ts` | 必须 | 104 行 | ✅ |
| `src/main/handlers/clipboardPopupHandlers.ts` | 必须 | ✅ | ✅ |
| `src/main/handlers/aiPopupHandlers.ts` | 必须 | ✅ | ✅ |
| `src/renderer/components/clipboard/ClipboardPopup.tsx` | 必须 | 248 行 | ✅ |
| `src/renderer/components/clipboard/popup-main.tsx` | 必须 | 10 行 | ✅ |
| `src/renderer/components/ai/AiPopup.tsx` | 必须 | 242 行 | ✅ |
| `src/renderer/components/ai/popup-main.tsx` | 必须 | 10 行 | ✅ |
| `resources/popup-clipboard.html` | 必须 | ✅ | ✅ |
| `resources/popup-ai.html` | 必须 | ✅ | ✅ |

---

## 三、规格对照检查

### 3.1 快捷键注册 ✅

- `shortcuts.ts`：macOS 用 `Command+Shift+V/A`，Windows/Linux 用 `CommandOrControl+Shift+V/A`，与规格一致
- 注册失败时有 `log.warn` 提示（macOS 引导到系统偏好设置）
- 主进程 `index.ts` 中正确注册，并在退出时注销

### 3.2 互斥显示逻辑 ✅

- 两个 popup 在快捷键回调中互斥：显示一个时先隐藏另一个
- 实现位置：`index.ts` 中的 `registerGlobalShortcuts` 回调

### 3.3 窗口配置

| 属性 | ClipboardPopup | AiPopup | 规格 |
|------|---------------|---------|------|
| width | 360 | 360 | ✅ |
| height | 480 | 400 | ✅ |
| frame | false | false | ✅ |
| resizable | false | false | ✅ |
| skipTaskbar | true | true | ✅ |
| alwaysOnTop | true | true | ✅ |
| blur 隐藏 | ✅ | ✅ | ✅ |

### 3.4 IPC Handlers ✅

- `clipboardPopupHandlers.ts`：`popup-get-clipboard-history`、`popup-copy-clipboard-item` ✅
- `aiPopupHandlers.ts`：`popup-send-ai-message`、`popup-get-ai-history`、`popup-clear-ai-chat` ✅
- `preload.ts`：所有 popup API 均已通过 `contextBridge` 暴露 ✅

### 3.5 渲染进程组件 ✅

- **ClipboardPopup**：搜索过滤、方向键/Tab 导航、Enter 复制、Escape 关闭、图片/文本显示、时间格式化 ✅
- **AiPopup**：对话历史、Enter 发送/Shift+Enter 换行、Escape 关闭、思考动画、错误处理 ✅

### 3.6 Tailwind 动画 ✅

- `tailwind.config.js` 定义了 `popup-appear`/`dot-wave` keyframe 和 animation ✅
- `popup-index.css` 包含原生 CSS `popup-appear`/`dot-wave` 定义（覆盖 tailwind） ✅
- ClipboardPopup 使用了 `animate-popup-appear` class ✅

---

## 四、发现的问题

### 🐛 问题 1（中等）：`getPopupPosition` 中 x 坐标计算有误

**文件**：`clipboardPopup.ts:23` 和 `aiPopup.ts:23`

**当前代码**：
```ts
let x = Math.max(dx, Math.min(dx + width - w - margin, dx + width - w - margin));
```

**问题**：`Math.min` 两个参数相同，结果恒为 `dx + width - w - margin`。popup 永远出现在**屏幕右边缘**，而非光标附近。

**修复建议**：
```ts
let x = cursor.x - Math.floor(w / 2);
x = Math.max(dx, Math.min(x, dx + width - w - margin));
```

---

### 🐛 问题 2（轻微）：AiPopup 缺少出现动画

**文件**：`src/renderer/components/ai/AiPopup.tsx`

**问题**：AiPopup 的根 div 缺少 `animate-popup-appear` class，窗口弹出时没有缩放动画，与 ClipboardPopup 行为不一致。

**修复**：在根 div 的 `className` 中添加 `animate-popup-appear`（需确保 `popup-index.css` 中的同名 class 加载正确）。

---

### ⚠️ 问题 3（轻微）：搜索无防抖

**文件**：`src/renderer/components/clipboard/ClipboardPopup.tsx`

ClipboardPopup 的搜索框 `onChange` 触发状态更新，但无 debounce。内容多时可能造成卡顿，建议添加 150-300ms 防抖。

---

### ⚠️ 问题 4（信息）：快捷键注册失败无 UI 提示

**文件**：`src/main/core/shortcuts.ts`

注册失败时仅输出 `log.warn`，用户无法从应用中感知。建议后续版本添加通知或设置页提示。

---

## 五、修复记录

以下问题已在本次 QA 过程中直接修复：

### ✅ P0：`getPopupPosition` x 坐标 bug（已修复）

**文件**：`clipboardPopup.ts`、`aiPopup.ts`

修复内容：将 `Math.min(..., dx + width - w - margin, dx + width - w - margin)`（两个相同参数）改为以光标为中心的计算：
```ts
// 修复前（错误）
let x = Math.max(dx, Math.min(dx + width - w - margin, dx + width - w - margin));

// 修复后（正确）
let x = cursor.x - Math.floor(w / 2);
x = Math.max(dx, Math.min(x, dx + width - w - margin));
```

### ✅ P1：AiPopup 缺少出现动画和键盘事件（已修复）

**文件**：`src/renderer/components/ai/AiPopup.tsx`

修复内容：给根 div 添加 `animate-popup-appear` class、`tabIndex={0}` 和 `onKeyDown={handleKeyDown}`，与 ClipboardPopup 保持一致。

---

## 六、剩余问题

| 优先级 | 问题 | 工作量 |
|--------|------|--------|
| P2 | 搜索框添加 debounce | 10 分钟 |
| P3 | 快捷键失败 UI 提示 | 30 分钟 |

---

## 七、总结

| 维度 | 状态 |
|------|------|
| 构建 | ✅ 全部通过 |
| 文件完整性 | ✅ 所有规格文件均存在 |
| 快捷键注册 | ✅ 正确 |
| 窗口配置 | ✅ 正确 |
| IPC handlers | ✅ 完整 |
| 渲染组件功能 | ✅ 完整 |
| 互斥逻辑 | ✅ 正确 |
| 失去焦点隐藏 | ✅ 正确 |
| 键盘导航 | ✅ 正确 |
| 出现动画 | ✅ ClipboardPopup + AiPopup 均已修复 |
| 位置计算 | ✅ 已修复 |

**结论**：实现完整，核心功能符合规格。P0 和 P1 问题已直接修复，剩余 P2/P3 为优化项，不阻塞功能。
