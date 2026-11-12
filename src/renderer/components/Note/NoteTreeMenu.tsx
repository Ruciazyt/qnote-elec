import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ElementType } from "react";
import { ChevronRight, FilePlus, FileText, FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  CREATABLE_NOTE_TYPES,
  getNoteTypeMeta,
  NoteTreeNode,
  NoteType,
} from "../../../shared/noteTypes";
import { NOTE_TYPE_ICONS } from "./noteIcons";
import { cn } from "@/lib/utils";

/** 主菜单宽度（px）—— 算位置时要给右侧的类型子菜单留出位置 */
const MENU_WIDTH = 196;
/** 类型子菜单宽度（px） */
const SUBMENU_WIDTH = 168;
/** 菜单项高度（px），用来估算菜单总高 */
const ITEM_HEIGHT = 28;
/** 菜单离窗口边缘至少留这么多 */
const EDGE_GAP = 8;

/** 右键点的目标 */
export interface NoteTreeMenuTarget {
  /** 点的目标是哪一类：文件夹 / 文件 / 列表空白处 */
  kind: "folder" | "file" | "blank";
  /** 文件夹或文件节点；空白处为 null */
  node: NoteTreeNode | null;
  /** 新建落点目录（相对路径，"" = 根目录） */
  folderRel: string;
}

interface NoteTreeMenuProps {
  /** 菜单左上角的视口坐标 */
  x: number;
  y: number;
  target: NoteTreeMenuTarget;
  /** 没设置笔记目录时禁掉新建项 */
  canCreate: boolean;
  onClose: () => void;
  /** 在目标目录里新建某个类型的笔记（没给就不出这一项） */
  onCreateFile?: (type: NoteType) => void;
  /** 在目标目录里新建文件夹 */
  onCreateFolder: () => void;
  /** 重命名目标条目 */
  onRename: () => void;
  /** 删除目标条目 */
  onDelete: () => void;
  /** 打开目标文件 */
  onOpen?: () => void;
  /** 重新读取目录 */
  onRefresh?: () => void;
}

/** 菜单项 */
type MenuEntry =
  | { type: "separator"; key: string }
  | {
      type: "item";
      key: string;
      label: string;
      icon: ElementType;
      onSelect: () => void;
      disabled?: boolean;
    }
  | {
      type: "submenu";
      key: string;
      label: string;
      icon: ElementType;
      disabled?: boolean;
      children: {
        key: string;
        label: string;
        /** 后缀，如 .md */
        hint: string;
        icon: ElementType;
        onSelect: () => void;
      }[];
    };

/**
 * 笔记文件树的右键菜单
 *
 * 行为对齐系统文件管理器：
 * - 右键文件夹 → 菜单里的新建项落在**这个文件夹里**，不是落在「新建位置」；
 * - 右键空白处 → 落在「新建位置」指向的目录；
 * - 「新建文件」是子菜单，按笔记类型分。
 *
 * 新建与刷新**只在这里** —— 侧栏工具栏那排图标按钮已经撤掉，
 * 同一个动作出现两处，用户会以为是两件事，还会分不清两者落点有什么不同。
 *
 * 位置用 fixed + 视口坐标：菜单是整个应用最上层的东西，不能被侧栏的
 * overflow 裁掉。算位置时预留出类型子菜单的宽度，否则贴着窗口右缘时
 * 子菜单会被推出屏幕。
 */
export default function NoteTreeMenu({
  x,
  y,
  target,
  canCreate,
  onClose,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onOpen,
  onRefresh,
}: NoteTreeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [subOpen, setSubOpen] = useState(false);
  /** 收起子菜单的延时器：鼠标从菜单项移到子菜单之间有一段空隙，
   *  不延时的话子菜单会在指针还没到之前就关掉 */
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => clearCloseTimer, []);

  // 点别处 / 按 Esc 都关掉
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-note-tree-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const isEntry = target.kind === "folder" || target.kind === "file";
  const isFile = target.kind === "file";

  const entries = useMemo<MenuEntry[]>(() => {
    const list: MenuEntry[] = [];

    // 空白处与文件夹才给新建项：右键一个文件时不新建（与系统一致）
    if (!isFile) {
      if (onCreateFile) {
        list.push({
          type: "submenu",
          key: "create-file",
          label: "新建文件",
          icon: FilePlus,
          disabled: !canCreate,
          children: CREATABLE_NOTE_TYPES.map((type) => ({
            key: type,
            label: getNoteTypeMeta(type).label,
            hint: getNoteTypeMeta(type).defaultExt,
            icon: NOTE_TYPE_ICONS[type],
            onSelect: () => onCreateFile(type),
          })),
        });
      }
      list.push({
        type: "item",
        key: "create-folder",
        label: "新建文件夹",
        icon: FolderPlus,
        disabled: !canCreate,
        onSelect: onCreateFolder,
      });
    }

    if (isEntry) {
      if (list.length > 0) list.push({ type: "separator", key: "sep-entry" });
      if (isFile && onOpen) {
        list.push({ type: "item", key: "open", label: "打开", icon: FileText, onSelect: onOpen });
      }
      list.push({ type: "item", key: "rename", label: "重命名", icon: Pencil, onSelect: onRename });
      list.push({ type: "item", key: "delete", label: "删除", icon: Trash2, onSelect: onDelete });
    }

    // 刷新是目录级的动作，只在空白处给（与系统一致）
    if (onRefresh && target.kind === "blank") {
      list.push({ type: "separator", key: "sep-refresh" });
      list.push({ type: "item", key: "refresh", label: "刷新列表", icon: RefreshCw, onSelect: onRefresh });
    }

    return list;
  }, [canCreate, isEntry, isFile, onCreateFile, onCreateFolder, onDelete, onOpen, onRefresh, onRename, target.kind]);

  const header = isFile ? null : `在「${target.folderRel || "根目录"}」下新建`;
  const footer = canCreate ? null : "请先设置笔记保存目录";

  // 位置：贴着指针，但要留在窗口里；右侧给子菜单留位
  const left = Math.max(EDGE_GAP, Math.min(x, window.innerWidth - MENU_WIDTH - SUBMENU_WIDTH - EDGE_GAP));
  const estimatedHeight =
    (header ? 26 : 0) + entries.length * ITEM_HEIGHT + (footer ? 26 : 0) + 12;
  const top = Math.max(EDGE_GAP, Math.min(y, window.innerHeight - estimatedHeight - EDGE_GAP));

  const openSub = () => {
    clearCloseTimer();
    setSubOpen(true);
  };
  const scheduleCloseSub = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setSubOpen(false), 140);
  };

  /** 顶层菜单项（不含子菜单里的） */
  const topItems = (): HTMLElement[] =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-entry] > button:not([disabled])') ?? []
    );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = topItems();
      if (items.length === 0) return;
      e.preventDefault();
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      items[(next + items.length) % items.length]?.focus();
      return;
    }

    // 右方向键展开子菜单
    if (e.key === "ArrowRight") {
      const el = document.activeElement as HTMLElement | null;
      if (el?.getAttribute("aria-haspopup") === "menu") {
        e.preventDefault();
        setSubOpen(true);
        // 子菜单是下一帧才挂上来的，等它出来再移焦点
        window.setTimeout(() => {
          menuRef.current
            ?.querySelector<HTMLElement>('[data-submenu] [role="menuitem"]')
            ?.focus();
        }, 0);
      }
      return;
    }

    // 左方向键收起子菜单，焦点回到父项
    if (e.key === "ArrowLeft") {
      const inSub = (document.activeElement as HTMLElement | null)?.closest("[data-submenu]");
      if (inSub) {
        e.preventDefault();
        const parent = inSub.parentElement?.querySelector<HTMLElement>("button");
        setSubOpen(false);
        parent?.focus();
      }
    }
  };

  const itemClass =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:hover:bg-transparent";

  return (
    <div
      ref={menuRef}
      data-note-tree-menu
      role="menu"
      aria-label="笔记文件操作"
      style={{ left, top }}
      onKeyDown={handleKeyDown}
      className="fixed z-[9999] w-[196px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {header && (
        <p className="px-2 py-1.5 text-label text-muted-foreground truncate" title={header}>
          {header}
        </p>
      )}

      {entries.map((entry) => {
        if (entry.type === "separator") {
          return <div key={entry.key} role="separator" className="my-1 h-px bg-border" />;
        }

        if (entry.type === "submenu") {
          const Icon = entry.icon;
          return (
            <div
              key={entry.key}
              data-menu-entry
              className="relative"
              onMouseEnter={openSub}
              onMouseLeave={scheduleCloseSub}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={subOpen}
                disabled={entry.disabled}
                onClick={() => {
                  // 点开而不是取反：指针移进来时已经展开过一次，
                  // 这里再取反就会把刚展开的子菜单又收起来。
                  clearCloseTimer();
                  setSubOpen(true);
                }}
                className={cn(itemClass, "pr-1")}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="flex-1">{entry.label}</span>
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              </button>

              {subOpen && (
                <div
                  data-submenu
                  role="menu"
                  aria-label="笔记类型"
                  className="absolute left-full top-0 z-10 w-[168px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                >
                  {entry.children.map((child) => {
                    const ChildIcon = child.icon;
                    return (
                      <button
                        key={child.key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          child.onSelect();
                          onClose();
                        }}
                        className={itemClass}
                      >
                        <ChildIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        <span className="flex-1">{child.label}</span>
                        <span className="font-mono text-micro text-muted-foreground">{child.hint}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        const Icon = entry.icon;
        return (
          <div key={entry.key} data-menu-entry>
            <button
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => {
                entry.onSelect();
                onClose();
              }}
              className={itemClass}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="flex-1">{entry.label}</span>
            </button>
          </div>
        );
      })}

      {footer && (
        <p className="mt-1 border-t border-border px-2 py-1.5 text-micro text-muted-foreground">{footer}</p>
      )}
    </div>
  );
}
