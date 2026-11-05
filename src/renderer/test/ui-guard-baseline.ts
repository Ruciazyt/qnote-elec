/**
 * UI 守卫的当前基线 —— 已知不合规项
 *
 * 这些是「已经查出来、还没改」的违规项，按签名记数量。
 * 基线之外再出现同类违规，守卫立刻变红。
 * 修好一项之后基线会多出一行「已修复」，提醒把对应条目删掉 ——
 * 那只是提醒，不拦构建：仓库要一直是绿的。
 *
 * 签名不含行号 —— 行号会随任何改动漂移，基线不能靠它定位。
 * 隐藏控件记的是「藏东西的位置」，不是「被藏住的按钮个数」：
 * 一个包装器把两个按钮一起藏住，算一处。
 */

import type { DestructiveDialogSpec } from "./ui-guards";

/**
 * 破坏性确认框清单
 *
 * 只列真正会删东西的确认框 —— 其它弹窗（OCR、清单编辑）不在这条要求里。
 * targetProp 是目标名的标识符：描述里必须点名它，读屏才念得出是哪一个。
 */
export const DESTRUCTIVE_DIALOGS: DestructiveDialogSpec[] = [
  { file: "components/clipboard/DeleteAllConfirmDialog.tsx", targetProp: null, label: "清空所有记录" },
  { file: "components/core/ClearVectorConfirmDialog.tsx", targetProp: null, label: "清空记忆索引" },
  { file: "components/apps/RemoveProjectDialog.tsx", targetProp: "name", label: "移除项目" },
];

/** ui 基类里的 1px 焦点环 */
export const THIN_FOCUS_RING_BASELINE: Record<string, number> = {
  "components/ui/calendar.tsx|focus-visible:ring-1": 1,
  "components/ui/input.tsx|focus-visible:ring-1": 1,
  "components/ui/select.tsx|focus:ring-1": 1,
  "components/ui/textarea.tsx|focus-visible:ring-1": 1,
  "components/ui/toast.tsx|focus:ring-1": 2,
};

/**
 * 被藏起来的可聚焦元素 —— 7 处
 *
 * 与 docs/UI-AUDIT-2026-11-05.md 的 P0-3 硬伤清单一一对应：
 *   AppProjectHeader 复制地址 / BookmarkList 打开+删除收藏 /
 *   SideBar 题单卡片编辑+删除 / StickyNoteApp 删除 / TodoEditDialog 移除附件 /
 *   BrowserPage 标签页关闭 / SkillsPage 技能操作区
 *
 * 2026-11-05 已修：题单页 SideBar（同时补了 focus-within:pointer-events-auto ——
 * 容器挡住了指针，键盘聚焦后也要能点）、StickyNoteApp 便签删除按钮。
 * 其余各条由各域 Bot 正在修，**全部改完后再统一从基线删** ——
 * 提前删会让守卫把「正在改、还没改完」的中间态报成新增违规，测试变红。
 */
export const HIDDEN_FOCUSABLE_BASELINE: Record<string, number> = {
  "components/apps/AppProjectHeader.tsx|视觉藏起": 1,
  "components/browser/BookmarkList.tsx|视觉藏起": 2,
  "components/todo/TodoEditDialog.tsx|视觉藏起": 1,
  "pages/BrowserPage.tsx|视觉藏起": 1,
  "pages/SkillsPage.tsx|视觉藏起": 1,
};

/** 破坏性确认框的描述问题 */
export const DESTRUCTIVE_DIALOG_BASELINE: Record<string, number> = {
  "components/apps/RemoveProjectDialog.tsx|描述没点名": 1,
};

/**
 * 品牌色底上用 text-primary 当字色 —— 32 处
 *
 * 分两批：
 *   基础态（22 处）—— 同一个元素上 bg-primary/N 与 text-primary 同现
 *   变体态（10 处）—— 悬停 / 聚焦时才出现的品牌底纹配品牌字
 *
 * 变体态那批原先看不见：「同一个元素、同一段 class」这种口径
 * 只认基础态，而 hover:bg-primary/10 hover:text-primary 才是最常见的写法。
 *
 * 2026-11-05 已修 8 处（剪贴板域全部改完）：
 * AiChatPanel 1、ClipboardList 4、ClipboardPopup 1、ImageOcrDialog 1。
 * 加上此前 ClipboardToolbar 的搜索结果徽章（基础态 + 变体态各 1），
 * 以及笔记域的 RichTextEditor 3 处、NoteTypeTabs 1 处，
 * 合计 38 → 30 处。
 *
 * ⚠️ 剩下的由各域 Bot 正在修，**全部改完后再统一从基线删** ——
 * 提前删会让守卫把「正在改、还没改完」的中间态报成新增违规，测试变红。
 */
export const BRAND_TEXT_BASELINE: Record<string, number> = {
  // 基础态
  "components/core/settings-card.tsx|bg-primary/10 text-primary": 1,
  "components/core/settings.tsx|bg-primary/10 text-primary": 5,
  "components/core/UpdateCard.tsx|bg-primary/10 text-primary": 2,
  "components/shortcut/AddShortcutDialog.tsx|bg-primary/[0.08] text-primary": 1,
  "components/shortcut/ShortcutPanel.tsx|bg-primary/10 text-primary": 1,
  "components/shortcut/ShortcutPanel.tsx|bg-primary/15 text-primary": 1,
  "components/todo/TodoList.tsx|bg-primary/5 text-primary": 1,
  "pages/HomePage.tsx|bg-primary/10 text-primary": 1,
  // 变体态
  "components/shortcut/AddShortcutDialog.tsx|hover:bg-primary/[0.08] text-primary": 1,
  "components/todo/TodoList.tsx|hover:bg-primary/10 text-primary": 2,
  "pages/HomePage.tsx|hover:bg-primary/15 text-primary": 1,
};
