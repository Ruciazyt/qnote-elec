import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ElementType } from "react";
import { ChevronRight, FilePlus, FileText, FolderOpen, FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  CREATABLE_NOTE_TYPES,
  getNoteTypeMeta,
  NoteTreeNode,
  NoteType,
} from "../../../shared/notes/noteTypes";
import { NOTE_TYPE_ICONS } from "./noteIcons";
import { cn } from "@/lib/utils";

const MENU_WIDTH = 196;
const SUBMENU_WIDTH = 168;
const ITEM_HEIGHT = 28;
const EDGE_GAP = 8;

export interface NoteTreeMenuTarget {
  kind: "folder" | "file" | "blank";
  node: NoteTreeNode | null;
  folderRel: string;
}

interface NoteTreeMenuProps {
  x: number;
  y: number;
  target: NoteTreeMenuTarget;
  canCreate: boolean;
  onClose: () => void;
  onCreateFile?: (type: NoteType) => void;
  onCreateFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpen?: () => void;
  onReveal?: () => void;
  onRefresh?: () => void;
}

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
        hint: string;
        icon: ElementType;
        onSelect: () => void;
      }[];
    };

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
  onReveal,
  onRefresh,
}: NoteTreeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [subOpen, setSubOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => clearCloseTimer, []);

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
      if (onReveal) {
        list.push({
          type: "item",
          key: "reveal",
          label: isFile ? "在文件夹中显示" : "在文件管理器中打开",
          icon: FolderOpen,
          onSelect: onReveal,
        });
      }
      list.push({ type: "item", key: "rename", label: "重命名", icon: Pencil, onSelect: onRename });
      list.push({ type: "item", key: "delete", label: "删除", icon: Trash2, onSelect: onDelete });
    }

    if (onRefresh && target.kind === "blank") {
      list.push({ type: "separator", key: "sep-refresh" });
      list.push({ type: "item", key: "refresh", label: "刷新列表", icon: RefreshCw, onSelect: onRefresh });
    }

    return list;
  }, [canCreate, isEntry, isFile, onCreateFile, onCreateFolder, onDelete, onOpen, onReveal, onRefresh, onRename, target.kind]);

  const header = isFile ? null : `在「${target.folderRel || "根目录"}」下新建`;
  const footer = canCreate ? null : "请先设置笔记保存目录";

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

    if (e.key === "ArrowRight") {
      const el = document.activeElement as HTMLElement | null;
      if (el?.getAttribute("aria-haspopup") === "menu") {
        e.preventDefault();
        setSubOpen(true);
        window.setTimeout(() => {
          menuRef.current
            ?.querySelector<HTMLElement>('[data-submenu] [role="menuitem"]')
            ?.focus();
        }, 0);
      }
      return;
    }

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
