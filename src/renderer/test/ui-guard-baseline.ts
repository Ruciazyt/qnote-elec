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

/**
 * ui 基类里的 1px 焦点环 —— 已清空
 *
 * 2026-11-05：components/ui 的 5 个文件（calendar / input / select / textarea / toast，
 * 共 6 处）统一改成 2px，与按钮基类同一档厚度。
 * 折叠轨余量复核过：轨宽 48、箭头按钮右内缩 8，2px 环还剩 6px 余量。
 */
export const THIN_FOCUS_RING_BASELINE: Record<string, number> = {};

/**
 * 被藏起来的可聚焦元素 —— 已清空
 *
 * 2026-11-05 已修：题单页 SideBar、StickyNoteApp 便签删除按钮、
 * AppProjectHeader 复制地址、TodoEditDialog 移除附件、SkillsPage 技能操作区。
 *
 * 2026-11-09 已修：BrowserPage 标签页关闭（focus-within:opacity-70 → /100）、
 * BookmarkList 的两个收藏按钮（focus-visible:text-muted-foreground/70 → 实心值）。
 * 守卫同步放宽了 focus 显形口径 —— 认 focus 变体的实心字色，
 * 见 ui-guards.ts 的 hasRevealForHidden。
 */
export const HIDDEN_FOCUSABLE_BASELINE: Record<string, number> = {};

/**
 * 破坏性确认框的描述问题 —— 已清空
 *
 * 2026-11-05：三个破坏性确认框的正文都进了 DialogDescription，
 * RemoveProjectDialog 还把项目名点进了描述里（读屏念得出删的是哪一个）。
 */
export const DESTRUCTIVE_DIALOG_BASELINE: Record<string, number> = {};

/**
 * 品牌色底上用 text-primary 当字色 —— 已清空
 *
 * 分两批：
 *   基础态（5 处）—— 同一个元素上 bg-primary/N 与 text-primary 同现
 *   变体态（4 处）—— 悬停 / 聚焦时才出现的品牌底纹配品牌字
 *
 * 变体态那批原先看不见：「同一个元素、同一段 class」这种口径
 * 只认基础态，而 hover:bg-primary/10 hover:text-primary 才是最常见的写法。
 *
 * 2026-11-05 已修 29 处：剪贴板域全部、笔记域（RichTextEditor / NoteTypeTabs）、
 * 应用域（settings-card / settings / UpdateCard）、
 * 浏览器题单域（BookmarkList / BrowserPage / SideBar）。
 *
 * 2026-11-09 已修剩下 9 处（快捷面板 4、待办徽章 3、首页 2）：
 * 文字换 `text-primary-strong`，底纹档没动（上限 /15）。
 */
export const BRAND_TEXT_BASELINE: Record<string, number> = {};
