import { memo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Folder, AppWindow, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShortcutRow } from "./types";

/**
 * 首字母色块的取色盘
 *
 * 只用低饱和度的一组色，且前景/背景用同一个色相的深浅两档 —— 放在一起
 * 才不会显得像一排彩色糖果。favicon 取不到时它就是唯一的视觉锚点，
 * 同一个站点必须每次都拿到同一个颜色，所以对 host 做哈希而不是随机。
 */
const LETTER_PALETTE = [
  { bg: "bg-sky-500/15", fg: "text-sky-600 dark:text-sky-400" },
  { bg: "bg-emerald-500/15", fg: "text-emerald-600 dark:text-emerald-400" },
  { bg: "bg-amber-500/15", fg: "text-amber-600 dark:text-amber-400" },
  { bg: "bg-violet-500/15", fg: "text-violet-600 dark:text-violet-400" },
  { bg: "bg-rose-500/15", fg: "text-rose-600 dark:text-rose-400" },
  { bg: "bg-teal-500/15", fg: "text-teal-600 dark:text-teal-400" },
];

/** 从标题里取一个字符作为首字母，全角/emoji 都能兜住 */
function initialOf(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0].toUpperCase();
}

function paletteFor(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return LETTER_PALETTE[hash % LETTER_PALETTE.length];
}

/**
 * 图标渲染 —— 三种来源，对应三类快捷方式
 *
 * icon 为 undefined 表示还在解析中：画一个占位方块而不是直接跳到兜底，
 * 否则每次开面板都会先闪一下文件夹/首字母、再换成真图标。
 */
export function ShortcutGlyph({
  item,
  icon,
  className,
}: {
  item: Pick<ShortcutRow, "kind" | "target" | "title">;
  /** data URL；null = 已确认取不到 */
  icon?: string | null;
  className?: string;
}) {
  if (icon) {
    return <img src={icon} alt="" className={cn("w-full h-full object-contain", className)} draggable={false} />;
  }

  // 文件夹固定用文件夹图标：不走 Win32 取 shell 合成图标（没有稳定的
  // 公开接口），lucide 图标还自带明暗主题适配
  if (item.kind === "folder") {
    return <Folder className={cn("w-full h-full text-amber-500/80", className)} strokeWidth={1.5} />;
  }

  if (icon === undefined) {
    return <div className={cn("w-full h-full rounded-md bg-muted/40 animate-pulse", className)} />;
  }

  if (item.kind === "url") {
    const palette = paletteFor(item.target);
    return (
      <div
        className={cn(
          "w-full h-full rounded-md flex items-center justify-center font-semibold",
          palette.bg,
          palette.fg,
          className
        )}>
        {initialOf(item.title || item.target)}
      </div>
    );
  }

  return <AppWindow className={cn("w-full h-full text-muted-foreground/70", className)} strokeWidth={1.5} />;
}

/** 图块主体：图标 + 标题。排序中的图块和拖拽浮层共用同一份渲染 */
function TileBody({ item, icon }: { item: ShortcutRow; icon?: string | null }) {
  return (
    <>
      <div className="w-9 h-9 shrink-0">
        <ShortcutGlyph item={item} icon={icon} />
      </div>
      <span className="w-full text-[11px] leading-tight text-center text-foreground/80 group-hover:text-foreground line-clamp-2 break-all">
        {item.title}
      </span>
    </>
  );
}

export interface ShortcutTileProps {
  item: ShortcutRow;
  icon?: string | null;
  onOpen: (id: number) => void;
  onEdit: (item: ShortcutRow) => void;
  onDelete: (item: ShortcutRow) => void;
}

/**
 * 单个快捷方式图块
 *
 * 拖拽交给 dnd-kit：整块都是拖拽面，被挤开的图块由排序策略算出 transform
 * 自己滑开让位 —— 「拖到哪就空出哪」的占位感就是这么来的，
 * 不再是松手前完全看不出会落在哪儿。
 *
 * 刻意不铺 dnd-kit 的 attributes：那会往这个 div 上加 role="button" 和
 * tabIndex=0，而图块里本来就有一个真按钮 —— 套上去等于每个图块多一个
 * Tab 停留点，键盘用户反而更难用。图块内的按钮保持原来的键盘可达性，
 * 键盘排序因此没有开启（见 ShortcutPanel 里的说明）。
 */
function ShortcutTileImpl({ item, icon, onOpen, onEdit, onDelete }: ShortcutTileProps) {
  const { setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, listeners } =
    useSortable({ id: item.id });

  // 节点与激活节点是同一个 div：dnd-kit 靠激活节点在拖完时把焦点还回去
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      setActivatorNodeRef(node);
    },
    [setNodeRef, setActivatorNodeRef]
  );

  return (
    <div
      ref={setRefs}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-xl p-2 pt-2.5 select-none",
        "border border-transparent cursor-grab transition-colors duration-150",
        "hover:bg-primary/[0.07] hover:border-primary/25",
        // 指针正压着的那一块：提示「松手会落在这里」
        isOver && !isDragging && "bg-primary/[0.10] border-primary/40",
        // 被拖起的那块留在原位当占位，真正的图块跟着指针走（DragOverlay）
        isDragging && "opacity-40"
      )}
      {...listeners}>
      {/* 编辑 / 删除 —— 悬停才出现，且不抢图标的点击。
          pointerdown 要掐断：冒泡到外层会被 dnd-kit 当成拖拽起点，
          在按钮上按下并移动鼠标会误触发一次排序。 */}
      <div
        className={cn(
          "absolute top-1 right-1 flex items-center gap-0.5 rounded-md bg-background/85 backdrop-blur-sm",
          "opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
        )}>
        <button
          type="button"
          aria-label={`编辑 ${item.title}`}
          title="编辑"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors">
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label={`删除 ${item.title}`}
          title="删除"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          className="rounded p-0.5 text-muted-foreground hover:!text-destructive hover:bg-foreground/10 transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onOpen(item.id)}
        title={item.target}
        className="w-full flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded-lg">
        <TileBody item={item} icon={icon} />
      </button>
    </div>
  );
}

export const ShortcutTile = memo(ShortcutTileImpl);

/**
 * 拖拽浮层里的图块副本
 *
 * 跟着指针走的那一块。原图块留在原位（半透明）当占位，
 * 两者叠在一起才有「拎起来」的感觉。
 */
export function ShortcutTilePreview({
  item,
  icon,
  width,
}: {
  item: ShortcutRow;
  icon?: string | null;
  /** 与原图块同宽，否则浮层和占位的尺寸对不上，一松手就会跳一下 */
  width: number;
}) {
  return (
    <div
      style={{ width }}
      className="flex flex-col items-center gap-1.5 rounded-xl p-2 pt-2.5 border border-primary/30 bg-card shadow-xl cursor-grabbing">
      <TileBody item={item} icon={icon} />
    </div>
  );
}
