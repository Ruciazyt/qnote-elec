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
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useCollapsedState } from "@/hooks/useCollapsedState";
import { cn } from "@/lib/utils";
import { ShortcutTile, ShortcutTilePreview } from "./ShortcutTile";
import { AddShortcutDialog } from "./AddShortcutDialog";
import { useExternalAddShortcut } from "./externalAdd";
import {
  SHORTCUT_PANEL_COLLAPSED_WIDTH,
  SHORTCUT_PANEL_WIDTH,
  type ShellMenuStatus,
  type ShortcutKind,
  type ShortcutRow,
} from "./types";

/** 折叠状态存 localStorage：面板宽度是长期偏好，不该每次启动都要重摆一次 */
const COLLAPSED_KEY = "qnote-shortcut-collapsed";

/**
 * 单个图块的宽度 —— 拖拽浮层要跟原图块一样宽，否则松手时会跳一下
 *
 * 面板宽 236，网格左右 padding 8×2，列间距 4，两列均分。
 */
const TILE_WIDTH = (SHORTCUT_PANEL_WIDTH - 16 - 4) / 2;

/**
 * 落点判定
 *
 * 先用「指针正压在哪个图块上」，指针落在两列之间的缝隙里才退回「离得最近的」。
 * 用最近中心做主判定会有反直觉的结果：指针明明压着下一格，落点却算到上一格。
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args);
};

export function ShortcutPanel() {
  const [collapsed, setCollapsed] = useCollapsedState(COLLAPSED_KEY, false);
  const [items, setItems] = useState<ShortcutRow[]>([]);
  /** id → data URL；值为 null 表示已确认取不到（区别于"还没解析"） */
  const [icons, setIcons] = useState<Record<number, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ShortcutRow | null>(null);
  const [preset, setPreset] = useState<{ kind: ShortcutKind; target: string; title: string } | null>(null);
  const [shellStatus, setShellStatus] = useState<ShellMenuStatus | null>(null);
  const [shellBusy, setShellBusy] = useState(false);
  /**
   * 注册项在、但命令已经失效 —— 右键能看见这一项，点了却毫无反应。
   *
   * 必须和"已开启"分开看：开关显示成开着的，用户理所当然会以为功能正常，
   * 实际右键点下去什么都没发生，而应用内部还觉得自己注册成功了。
   */
  const shellBroken = !!shellStatus?.enabled && shellStatus?.valid === false;
  const [showShellRow, setShowShellRow] = useState(false);
  /** 正在拖动的图块 id；非 null 时渲染拖拽浮层 */
  const [activeId, setActiveId] = useState<number | null>(null);
  /** 被拖图块的实测宽度 —— 浮层要跟它一样宽，否则松手时会跳一下 */
  const [activeWidth, setActiveWidth] = useState<number | null>(null);
  const [osDropActive, setOsDropActive] = useState(false);
  const { toast } = useToast();

  /**
   * 指针传感器
   *
   * 位移超过 4px 才算拖拽：不设这个门槛的话，点一下快捷方式也会被判成
   * 一次拖拽，把「单击打开」的点击吃掉。
   * dnd-kit 在拖拽真正开始后会拦掉紧随其后的 click，所以拖完不会误开。
   *
   * 刻意不挂 KeyboardSensor：键盘排序要求可排序元素本身可聚焦，
   * 而图块里已经有一个「打开」按钮 —— 给外层 div 加 tabIndex 会让
   * 每个图块多一个 Tab 停留点，键盘用户反而更难用。
   */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    })
  );

  /** 正在拖动的图块 —— 浮层用它渲染 */
  const activeItem = useMemo(
    () => (activeId === null ? null : (items.find((item) => item.id === activeId) ?? null)),
    [activeId, items]
  );

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

  /**
   * 图标逐个解析、谁先回来谁先显示
   *
   * 依赖用 id+target 的拼接串而不是 items 本身：拖拽排序会让数组引用整个换掉，
   * 用引用做依赖等于每次排序都重新解析一遍全部图标（favicon 要联网、
   * exe 图标要起 powershell）。拼接串只在意图变化时才变。
   *
   * 刻意一条一条发而不是批量：网页 favicon 几百毫秒、本地程序图标要 2~4 秒，
   * 批量的话慢的那个会把所有图标一起压到 4 秒后才出现。
   */
  const iconKey = items.map((item) => `${item.id}:${item.target}`).join("|");
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    for (const item of items) {
      if (item.id in icons) continue;
      void window.electron.shortcutResolveIcon(item.kind, item.target).then((dataUrl) => {
        if (cancelled) return;
        // 可能已经有一次更早的请求先回来了，不要用慢的结果覆盖
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

  /**
   * 系统右键菜单唤起
   *
   * 先让主进程判类型、校验目标，再决定要不要弹框：路径可能早就被删了，
   * 那时该报的是"路径不存在"，而不是弹一个空的表单让用户自己填。
   */
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
      // 本地同步删掉图标缓存条目，否则图标 Map 里会一直挂着孤儿 key
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

  /**
   * 排序落库
   *
   * 先本地换序再写库：拖拽是高频操作，等一次 IPC 往返会让图块明显粘手。
   * 写库失败则整体回滚到拖之前的顺序，不留"界面是新顺序、库里是旧顺序"的错位。
   */
  function persistOrder(next: ShortcutRow[], previous: ShortcutRow[]) {
    setItems(next);
    void window.electron.shortcutReorder(next.map((item) => item.id)).then((ok) => {
      if (!ok) {
        setItems(previous);
        toast({ title: "排序保存失败，已还原", variant: "destructive" });
      }
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(Number(event.active.id));
    // dnd-kit 启动时已经量过被拖元素的尺寸，直接拿来给浮层用
    const rect = event.active.rect.current.initial;
    setActiveWidth(rect && rect.width > 0 ? rect.width : null);
  }

  /**
   * 松手落位
   *
   * arrayMove 把被拖的图块换到落点图块原来的位置 —— 落点那一块被顶开，
   * 而不是「插到它前面」。这正是之前那版「往下拖却跳回上一格」的根源：
   * 旧实现把落点固定解释成「目标之前」，方向一变就差一格。
   */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setActiveWidth(null);
    if (!over || active.id === over.id) return;

    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;

    const previous = items;
    persistOrder(arrayMove(items, from, to), previous);
  }

  const hasOsFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types ?? []).includes("Files");

  /** 把系统里拖进来的文件/文件夹批量收编 */
  async function onOsDrop(e: React.DragEvent) {
    if (!hasOsFiles(e)) return;
    e.preventDefault();
    setOsDropActive(false);
    setActiveId(null);

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

  /**
   * 修复失效的右键菜单命令
   *
   * "菜单项在、点了没反应"有三种成因：应用更新后换了安装目录、
   * 旧版本残留的注册项、或者注册表写到一半留下空命令。
   * 这三种在资源管理器里的表现完全一样，光看"开关是开的"分辨不出来，
   * 所以这里要有一个能一键修好的出口，而不是让用户自己去掏注册表。
   */
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

  // ---------------------------------------------------------------- 收起态
  if (collapsed) {
    return (
      <aside
        className="shrink-0 border-l border-border/40 flex flex-col transition-[width] duration-200 ease-out"
        style={{ width: SHORTCUT_PANEL_COLLAPSED_WIDTH }}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="展开快捷方式"
          aria-label="展开快捷方式"
          className="flex-1 flex flex-col items-center gap-3 py-3 text-muted-foreground/60 hover:text-foreground hover:bg-accent/40 transition-colors">
          <ChevronRight className="h-4 w-4 shrink-0" />
          <span className="text-[11px] tracking-widest select-none" style={{ writingMode: "vertical-rl" }}>
            快捷方式
          </span>
          {items.length > 0 && (
            <span className="shrink-0 rounded-full bg-primary/15 text-primary text-[10px] font-medium px-1.5 py-0.5 tabular-nums">
              {items.length}
            </span>
          )}
        </button>
      </aside>
    );
  }

  // ---------------------------------------------------------------- 展开态
  return (
    <aside
      className="shrink-0 border-l border-border/40 flex flex-col min-h-0 transition-[width] duration-200 ease-out"
      style={{ width: SHORTCUT_PANEL_WIDTH }}>
      <div className="flex items-center gap-1 px-3 h-11 border-b border-border/40 shrink-0">
        <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-[12px] font-medium text-foreground/80 flex-1 truncate">快捷方式</span>
        {items.length > 0 && (
          <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">{items.length}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={openAddDialog}
          title="添加快捷方式"
          aria-label="添加快捷方式"
          className="h-7 w-7 p-0 shrink-0">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowShellRow((v) => !v)}
          title="快捷方式设置"
          aria-label="快捷方式设置"
          aria-expanded={showShellRow}
          className={cn(
            "h-7 w-7 p-0 shrink-0",
            showShellRow && "bg-primary/10 text-primary"
          )}>
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(true)}
          title="收起快捷方式"
          aria-label="收起快捷方式"
          className="h-7 w-7 p-0 shrink-0">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 面板级设置：系统右键菜单开关 + 清空 */}
      {showShellRow && (
        <div className="px-3 py-2.5 border-b border-border/40 flex flex-col gap-2.5 shrink-0 animate-fade-in">
          {shellStatus?.supported ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-foreground/85">系统右键菜单</div>
                  <div className="text-[10px] text-muted-foreground/60 leading-snug mt-0.5">
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
              {/* 注册项在、命令失效：开关是"开"的，但功能是坏的。
                  这里必须说清楚，并给一个当场就能修好的入口 ——
                  否则用户只会看到"明明开着却没用"。 */}
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
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
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

      {/* 面板主体。
          这里的原生 drag 事件只服务「把系统文件拖进来」这一条路径 ——
          面板内部的排序已经交给 dnd-kit，它用的是指针事件，不走 HTML5 拖放，
          两条路径互不干扰。 */}
      <div
        onDragOver={(e) => {
          if (!hasOsFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOsDropActive(true);
        }}
        onDragLeave={(e) => {
          // 只有真正离开容器才取消高亮。子元素之间的移动会冒泡出一串
          // dragleave，不做 contains 判断的话高亮会一直闪
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
          /* 排序范围：两列网格，用 rectSortingStrategy 而不是纵向列表策略 ——
             列表策略只按上下算位移，在网格里会算歪 */
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              setActiveId(null);
              setActiveWidth(null);
            }}>
            <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-1">
                {items.map((item) => (
                  <ShortcutTile
                    key={item.id}
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
                ))}
              </div>
            </SortableContext>

            {/* 跟着指针走的那一块；原图块留在原位（半透明）当占位 */}
            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
              {activeItem ? (
                <ShortcutTilePreview
                  item={activeItem}
                  icon={activeItem.id in icons ? icons[activeItem.id] : undefined}
                  width={activeWidth ?? TILE_WIDTH}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
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
