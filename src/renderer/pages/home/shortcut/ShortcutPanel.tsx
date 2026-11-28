import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  LayoutGrid,
  Loader2,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_HEADER_PADDING_X,
  PANEL_RAIL_LABEL_INSET,
} from "@/components/panel/layout";
import { useDragReorder } from "@/hooks/ui/useDragReorder";
import { useToast } from "@/hooks/ui/use-toast";
import { useCollapsedState } from "@/hooks/panel/useCollapsedState";
import { cn } from "@/lib/utils";
import { ShortcutTile } from "./ShortcutTile";
import { AddShortcutDialog } from "./AddShortcutDialog";
import { useExternalAddShortcut } from "./externalAdd";
import {
  SHORTCUT_PANEL_COLLAPSED_WIDTH,
  SHORTCUT_PANEL_WIDTH,
  type ShellMenuStatus,
  type ShortcutKind,
  type ShortcutRow,
} from "./types";

const COLLAPSED_KEY = "qnote-shortcut-collapsed";

export function ShortcutPanel() {
  const [collapsed, setCollapsed] = useCollapsedState(COLLAPSED_KEY, false);
  const [items, setItems] = useState<ShortcutRow[]>([]);
  const [icons, setIcons] = useState<Record<number, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShortcutRow | null>(null);
  const [preset, setPreset] = useState<{ kind: ShortcutKind; target: string; title: string } | null>(null);
  const [shellStatus, setShellStatus] = useState<ShellMenuStatus | null>(null);
  const [shellBusy, setShellBusy] = useState(false);
  const shellBroken = !!shellStatus?.enabled && shellStatus?.valid === false;
  const [showShellRow, setShowShellRow] = useState(false);
  const [osDropActive, setOsDropActive] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      setItems(await window.electron.shortcutList());
    } catch (err) {
      console.error("读取快捷方式失败", err);
      toast({ title: "读取快捷方式失败", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadShellStatus = useCallback(async () => {
    try {
      setShellStatus(await window.electron.getShellContextMenuStatus());
    } catch (err) {
      console.error("查询系统右键菜单状态失败", err);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadShellStatus();
  }, [load, loadShellStatus]);

  useEffect(() => {
    const unsubscribe = window.electron.onShortcutsChanged(() => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const iconKey = items.map((item) => `${item.id}:${item.target}`).join("|");
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    for (const item of items) {
      if (item.id in icons) continue;
      void window.electron.shortcutResolveIcon(item.kind, item.target).then((dataUrl) => {
        if (cancelled) return;
        setIcons((prev) => (item.id in prev ? prev : { ...prev, [item.id]: dataUrl ?? null }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconKey]);

  const openAddDialog = useCallback(() => {
    setEditing(null);
    setPreset(null);
    setDialogOpen(true);
  }, []);

  const handleExternalAdd = useCallback(
    async (raw: string) => {
      try {
        const normalized = await window.electron.shortcutNormalizeTarget(raw);
        if (!normalized) return;
        if ("error" in normalized) {
          toast({ title: "无法添加", description: normalized.error, variant: "destructive" });
          return;
        }
        setEditing(null);
        setPreset(normalized);
        setDialogOpen(true);
      } catch (err) {
        console.error("处理外部添加请求失败", err);
      }
    },
    [toast]
  );

  useExternalAddShortcut(handleExternalAdd);

  async function handleOpen(id: number) {
    const result = await window.electron.shortcutOpen(id);
    if (!result.success) {
      toast({
        title: "打不开",
        description: result.error ?? "目标可能已被移动或删除",
        variant: "destructive",
      });
    }
  }

  async function handleDelete(item: ShortcutRow) {
    const ok = await window.electron.shortcutDelete(item.id);
    if (ok) {
      setIcons((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      toast({ title: `已删除「${item.title}」` });
    } else {
      toast({ title: "删除失败", variant: "destructive" });
    }
  }

  async function handleSubmit(input: { kind: ShortcutKind; target: string; title?: string }) {
    try {
      if (editing) {
        const result = await window.electron.shortcutUpdate(editing.id, {
          title: input.title,
          target: input.target,
        });
        if (!result.success) {
          toast({ title: "保存失败", description: result.error, variant: "destructive" });
          return false;
        }
        await load();
        toast({ title: "已保存" });
        return true;
      }

      const result = await window.electron.shortcutAdd(input);
      if (!result.success) {
        toast({ title: "添加失败", description: result.error, variant: "destructive" });
        return false;
      }
      await load();
      toast({ title: `已添加「${input.title ?? input.target}」` });
      return true;
    } catch (err) {
      console.error("提交快捷方式失败", err);
      toast({ title: "操作失败", variant: "destructive" });
      return false;
    }
  }

  async function handleClearAll() {
    const ok = await window.electron.shortcutClear();
    if (ok) {
      setIcons({});
      setItems([]);
      toast({ title: "已清空全部快捷方式" });
    } else {
      toast({ title: "清空失败", variant: "destructive" });
    }
  }

  function persistOrder(next: ShortcutRow[], previous: ShortcutRow[]) {
    setItems(next);
    void window.electron
      .shortcutReorder(next.map((item) => item.id))
      .then((ok) => {
        if (!ok) {
          setItems(previous);
          toast({ title: "排序保存失败，已还原", variant: "destructive" });
        }
      })
      .catch((err) => {
        console.error("保存快捷方式排序失败", err);
        setItems(previous);
        toast({ title: "排序保存失败，已还原", variant: "destructive" });
      });
  }

  const itemsById = useMemo(
    () => new Map(items.map((item) => [String(item.id), item])),
    [items]
  );

  const drag = useDragReorder({
    ids: items.map((item) => String(item.id)),
    onReorder: (next) => {
      const nextItems = next
        .map((id) => itemsById.get(id))
        .filter((item): item is ShortcutRow => item !== undefined);
      if (nextItems.length !== items.length) return;
      persistOrder(nextItems, items);
    },
    mode: "grid",
    columns: 2,
    amplitude: 10,
    labelOf: (id) => itemsById.get(id)?.title ?? "",
  });

  const hasOsFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types ?? []).includes("Files");

  async function onOsDrop(e: React.DragEvent) {
    if (!hasOsFiles(e)) return;
    e.preventDefault();
    setOsDropActive(false);

    const paths = Array.from(e.dataTransfer.files ?? [])
      .map((file) => {
        try {
          return window.electron.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (paths.length === 0) return;

    let added = 0;
    const failures: string[] = [];
    for (const path of paths) {
      try {
        const normalized = await window.electron.shortcutNormalizeTarget(path);
        if (!normalized || "error" in normalized) {
          failures.push(path);
          continue;
        }
        const result = await window.electron.shortcutAdd(normalized);
        if (result.success) added++;
        else failures.push(path);
      } catch {
        failures.push(path);
      }
    }
    await load();
    if (added > 0) toast({ title: `已添加 ${added} 个快捷方式` });
    if (failures.length > 0) {
      toast({
        title: `${failures.length} 个没能添加`,
        description: failures[0],
        variant: "destructive",
      });
    }
  }

  async function toggleShellMenu(next: boolean) {
    setShellBusy(true);
    try {
      const result = await window.electron.setShellContextMenuEnabled(next);
      if (result.success) {
        setShellStatus((prev) => ({
          ...(prev ?? { supported: true, enabled: false, valid: false }),
          enabled: next,
          valid: next,
        }));
        toast({ title: next ? "已添加到系统右键菜单" : "已从系统右键菜单移除" });
      } else {
        toast({ title: "设置失败", description: result.error, variant: "destructive" });
      }
    } finally {
      setShellBusy(false);
    }
  }

  async function repairShellMenu() {
    setShellBusy(true);
    try {
      const result = await window.electron.repairShellContextMenu();
      if (result.success) {
        const status = await window.electron.getShellContextMenuStatus();
        setShellStatus(status);
        toast({
          title: result.repaired ? "右键菜单已修复" : "右键菜单无需修复",
          description: result.repaired ? "现在右键文件或文件夹就能添加快捷方式了" : undefined,
        });
      } else {
        toast({ title: "修复失败", description: result.error, variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "修复失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    } finally {
      setShellBusy(false);
    }
  }

  if (collapsed) {
    return (
      <aside
        className="shrink-0 flex flex-col transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: SHORTCUT_PANEL_COLLAPSED_WIDTH,
          boxShadow: "inset 1px 0 0 0 hsl(var(--border) / 0.6)",
        }}>
        {
}
        <div
          className="flex justify-end pt-2 shrink-0"
          style={{ paddingRight: PANEL_COLLAPSED_BUTTON_INSET }}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(false)}
            title="展开快捷方式"
            aria-label="展开快捷方式"
            className="h-8 w-8">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {
}
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="展开快捷方式"
          aria-label={`展开快捷方式面板（${items.length} 项）`}
          style={{
            marginLeft: PANEL_RAIL_LABEL_INSET,
            marginRight: PANEL_RAIL_LABEL_INSET,
            marginBottom: PANEL_RAIL_LABEL_INSET,
          }}
          className="flex-1 flex flex-col items-center gap-3 py-3 text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors">
          <span className="text-xs tracking-widest select-none" style={{ writingMode: "vertical-rl" }}>
            快捷方式
          </span>
          {items.length > 0 && (
            <span className="shrink-0 rounded-full bg-primary/15 text-primary-strong text-xs font-medium px-1.5 py-0.5 tabular-nums">
              {items.length}
            </span>
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="shrink-0 border-l border-border/60 flex flex-col min-h-0 transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: SHORTCUT_PANEL_WIDTH }}>
      {
}
      <div
        style={{
          paddingLeft: PANEL_HEADER_PADDING_X,
          paddingRight: PANEL_HEADER_PADDING_X,
          boxShadow: "inset 0 -1px 0 0 hsl(var(--border) / 0.6)",
        }}
        className="flex items-center gap-1 h-12 pt-2 pb-2 shrink-0">
        <LayoutGrid className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground flex-1 truncate">快捷方式</span>
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{items.length}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={openAddDialog}
          title="添加快捷方式"
          aria-label="添加快捷方式"
          className="h-8 w-8 p-0 shrink-0">
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowShellRow((v) => !v)}
          title="快捷方式设置"
          aria-label="快捷方式设置"
          aria-expanded={showShellRow}
          className={cn(
            "h-8 w-8 p-0 shrink-0",
            showShellRow && "bg-primary/10 text-primary-strong"
          )}>
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(true)}
          title="收起快捷方式"
          aria-label="收起快捷方式"
          className="h-8 w-8 p-0 shrink-0">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {}
      {showShellRow && (
        <div className="px-3 py-2.5 border-b border-border/60 flex flex-col gap-2.5 shrink-0 animate-fade-in">
          {shellStatus?.supported ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">系统右键菜单</div>
                  <div className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                    {shellBroken
                      ? "菜单项在，但点了没反应"
                      : "右键文件或文件夹即可添加到快捷方式"}
                  </div>
                </div>
                <Switch
                  checked={shellStatus.enabled}
                  disabled={shellBusy}
                  onCheckedChange={toggleShellMenu}
                  aria-label="系统右键菜单"
                />
              </div>
              {
}
              {shellBroken && (
                <button
                  type="button"
                  onClick={repairShellMenu}
                  disabled={shellBusy}
                  className="flex items-center gap-1 self-start text-[10px] text-destructive/90 hover:text-destructive transition-colors disabled:opacity-50">
                  <Wrench className="h-3 w-3" />
                  {shellStatus.reason ?? "右键菜单命令已失效，重新注册一下"}
                  <span className="underline underline-offset-2">修复</span>
                </button>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              系统右键菜单：{shellStatus?.reason ?? "不可用"}
            </p>
          )}

          {items.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-destructive transition-colors self-start">
              <Trash2 className="h-3 w-3" />
              清空全部
            </button>
          )}
        </div>
      )}

      {
}
      <div
        onDragOver={(e) => {
          if (!hasOsFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOsDropActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setOsDropActive(false);
        }}
        onDrop={(e) => {
          if (!hasOsFiles(e)) return;
          void onOsDrop(e);
        }}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto p-2 transition-colors",
          osDropActive && "bg-primary/[0.08]"
        )}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-muted-foreground/70">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中...
          </div>
        ) : items.length === 0 ? (
          <div
            className={cn(
              "h-full flex flex-col items-center justify-center gap-2 text-center px-2 rounded-lg",
              osDropActive && "ring-1 ring-primary/40"
            )}>
            <LayoutGrid className="h-5 w-5 text-muted-foreground/25" />
            <p className="text-[11px] text-muted-foreground/70">还没有快捷方式</p>
            <p className="text-[10px] text-muted-foreground/45 leading-relaxed">
              点上方 + 添加，或把文件、文件夹拖进来
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={openAddDialog}
              className="mt-1 h-7 text-[11px] gap-1">
              <Plus className="h-3 w-3" />
              添加
            </Button>
          </div>
        ) : (
          <div
            ref={drag.containerRef}
            onPointerDown={drag.handlePointerDown}
            role="list"
            data-drag-active={drag.isDragging ? "true" : "false"}
            className="drag-reorder-container relative grid grid-cols-2 gap-1">
            {items.map((item) => {
              const id = String(item.id);
              return (
                <div
                  key={item.id}
                  ref={drag.registerItem(id)}
                  data-drag-item=""
                  data-drag-item-id={id}
                  data-drag-state={drag.stateOf(id)}
                  role="listitem"
                  aria-roledescription="可拖动排序项"
                  tabIndex={0}
                  onKeyDown={(event) => drag.handleKeyDown(id, event)}
                  className="drag-reorder-item rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
                  <ShortcutTile
                    item={item}
                    icon={item.id in icons ? icons[item.id] : undefined}
                    onOpen={handleOpen}
                    onEdit={(target) => {
                      setPreset(null);
                      setEditing(target);
                      setDialogOpen(true);
                    }}
                    onDelete={handleDelete}
                  />
                </div>
              );
            })}
            <div
              ref={drag.hintRef}
              className="drag-reorder-hint"
              data-active="false"
              data-orientation="vertical"
              aria-hidden="true">
              <div className="drag-reorder-hint-inner" />
            </div>
          </div>
        )}
      </div>

      <div className="sr-only" aria-live="polite">
        {drag.announcement}
      </div>

      <AddShortcutDialog
        open={dialogOpen}
        editing={editing}
        preset={preset}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
          setPreset(null);
        }}
        onSubmit={handleSubmit}
        onShellMenuChange={(enabled) =>
          setShellStatus((prev) => ({
            ...(prev ?? { supported: true, enabled: false, valid: false }),
            enabled,
            valid: enabled,
          }))
        }
        shellMenuStatus={shellStatus}
        shellMenuBusy={shellBusy}
      />
    </aside>
  );
}
