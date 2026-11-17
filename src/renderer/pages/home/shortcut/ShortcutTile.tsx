import { memo, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Folder, AppWindow, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShortcutRow } from "./types";

const LETTER_PALETTE = [
  { bg: "bg-sky-500/15", fg: "text-sky-600 dark:text-sky-400" },
  { bg: "bg-emerald-500/15", fg: "text-emerald-600 dark:text-emerald-400" },
  { bg: "bg-amber-500/15", fg: "text-amber-600 dark:text-amber-400" },
  { bg: "bg-violet-500/15", fg: "text-violet-600 dark:text-violet-400" },
  { bg: "bg-rose-500/15", fg: "text-rose-600 dark:text-rose-400" },
  { bg: "bg-teal-500/15", fg: "text-teal-600 dark:text-teal-400" },
];

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

export function ShortcutGlyph({
  item,
  icon,
  className,
}: {
  item: Pick<ShortcutRow, "kind" | "target" | "title">;
  icon?: string | null;
  className?: string;
}) {
  if (icon) {
    return <img src={icon} alt="" className={cn("w-full h-full object-contain", className)} draggable={false} />;
  }

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

function ShortcutTileImpl({ item, icon, onOpen, onEdit, onDelete }: ShortcutTileProps) {
  const { setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, listeners } =
    useSortable({ id: item.id });

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
        isOver && !isDragging && "bg-primary/[0.10] border-primary/40",
        isDragging && "opacity-40"
      )}
      {...listeners}>
      {
}
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

export function ShortcutTilePreview({
  item,
  icon,
  width,
}: {
  item: ShortcutRow;
  icon?: string | null;
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
