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
import {
  PANEL_COLLAPSED_BUTTON_INSET,
  PANEL_HEADER_PADDING_X,
  PANEL_RAIL_LABEL_INSET,
} from "@/components/panel/layout";
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
   * 快捷方式表被面板之外改了
   *
   * 改这张表的入口不止面板自己 —— 剪贴板面板的「添加到快捷方式」
   * 就是从面板之外改的。收到广播后重新拉一次，否则那条快捷方式要等
   * 下次进主页才看得见，用户会以为没加上。
   *
   * 面板自己发起的增删改也会收到这条广播（主进程在写库后统一广播），
   * 于是会多拉一次列表 —— 同一条数据拉两遍的代价远小于漏刷新。
   */
  useEffect(() => {
    const unsubscribe = window.electron.onShortcutsChanged(() => {
      void load();
    });
    return unsubscribe;
  }, [load]);

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
  //
  // motion-reduce:transition-none 是系统级「减少动态效果」的退路：
  // 开着的时候面板宽度直接到位，不做空间位移。对齐笔记页、题单页与
  // 通用面板件 ResizableSidebar（2026-11-05 走查补齐）。
  if (collapsed) {
    return (
      <aside
        className="shrink-0 flex flex-col transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: SHORTCUT_PANEL_COLLAPSED_WIDTH,
          // 收起态用内阴影画分隔线，不画边框：
          // 边框会占掉内容盒（48 - 1 = 47px），按钮锚在距右缘 8px 处，
          // 右侧就只剩 7px，左右留白不相等。inset 阴影画在盒内、不占布局，
          // 颜色与展开态的 border-border/60 完全等价，切换时那条线也不挪位置。
          boxShadow: "inset 1px 0 0 0 hsl(var(--border) / 0.6)",
        }}>
        {/* 切换按钮：32×32（PANEL_COLLAPSED_BUTTON_SIZE），锚在「距面板右缘 8px」
            （PANEL_COLLAPSED_BUTTON_INSET）—— 和展开态头部里那个收起按钮同一个 x，
            折叠↔展开时按钮原地不动，只是旁边的面板在变宽变窄。

            这里用**固定锚定**（右内边距 + justify-end），不用 justify-center 居中：
            居中在「分隔线不占内容盒」时恰好也是 8px、看着等价，但它把按钮位置
            绑在这个前提上 —— 分隔线一旦改回真边框（内容盒 47px），居中会算出
            7.5px 的小数偏移、左右留白变成 7.5 / 8.5；而且宽度过渡期间轨道还是宽的，
            居中会把按钮摆到轨道中线而不是钉在锚点上。
            固定锚定两种情况都稳，理由见 panel/layout.ts。 */}
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

        {/* 竖排标签 + 角标：保持可点，点了也能展开。
            原来是整条轨一个按钮（箭头 + 文字 + 角标全塞在一个 button 里），
            那样 focus 描边会绕满整条轨、贴着窗口右缘被裁掉，
            所以把箭头拆成独立的 32×32 按钮，标签自己留一个点击区。

            可访问名称要与箭头按钮区分开：两个都叫「展开快捷方式」的话，
            读屏用户会听到两次一模一样的名字，分不清哪个是箭头、哪个是标签
            （docs/UI-GUIDELINES.md 第五节）。标签这个按「内容」命名 ——
            它显示的是面板名「快捷方式」和条目数角标，名称里带上条目数，
            两者的信息量就分开了。title 用短名，保持原生悬停提示的惯例。

            内缩用 PANEL_RAIL_LABEL_INSET（4px）而不是写死的 mx-1 / mb-1：
            这个面板贴在窗口右缘，描边向外扩 1px 会超出视口，用户看到的焦点框
            就缺一条右边；左右各内缩 4px，描边（按钮盒外 1px）离轨道边缘还剩 3px。
            下边同理 —— 这个按钮是 flex-1，会一直撑到轨道底部，不留底边距的话
            描边往下的那 1px 会落到轨道外面被裁掉，焦点框缺一条底边。

            余量与描边粗细挂钩：描边加粗到 2px 后余量降到 2px，仍完整可见；
            详见 panel/layout.ts 里 PANEL_RAIL_LABEL_INSET 的注释。

            竖排标题与角标都用 text-xs（12px）：标题是这趟轨上唯一的文字，
            11px 在高 DPI 下偏细；角标是计数，与展开态头部右侧那个纯数字
            同属一类信息，字号定档到同一档。 */}
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

  // ---------------------------------------------------------------- 展开态
  return (
    <aside
      className="shrink-0 border-l border-border/60 flex flex-col min-h-0 transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: SHORTCUT_PANEL_WIDTH }}>
      {/* 头部：标题 + 操作区。
          左右内边距走行内样式（PANEL_HEADER_PADDING_X = 8px），和折叠轨里
          按钮的锚点一致 —— 收起按钮离面板右缘 8px，折叠态那个箭头也离右缘 8px，
          折叠↔展开时按钮原地不动。三个操作按钮统一 32×32，
          和其它页面的折叠按钮同尺寸。

          行高用 h-12 + pt-2 + pb-2（和其它面板的头部一致）：内容盒正好 32px，
          32px 的按钮填满它，于是按钮落在距顶 8px 处、占 8..40 ——
          与折叠态那个箭头（pt-2 + 32px 按钮）同一个纵向区间，切换时纵向零位移。

          下缘线用等色 inset 阴影画在盒内，不占内容盒：原来那条 border-b 会把
          内容盒切掉 1px（48 - 1 - 8 - 8 = 31px），32px 的按钮装不下，
          items-center 会算出 7.5..39.5 的小数区间，与折叠态箭头差 0.5px。
          inset 阴影画在盒内不占布局，内容盒仍是 32px、按钮仍是 8..40，
          两态零位移；颜色与展开态那条 border-border/60 完全等价。

          注意：面板左缘那条 border-l border-border/60 保留不动 ——
          第十一节定稿「展开态一律 1px 语义边框、折叠态才用 inset 阴影」
          管的是面板边界线（竖向），头部下缘线是横的，两者不冲突。 */}
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

      {/* 面板级设置：系统右键菜单开关 + 清空 */}
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
