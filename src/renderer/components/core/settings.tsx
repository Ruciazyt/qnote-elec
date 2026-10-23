import { toast } from "@/hooks/use-toast";
import { useCallback, useEffect, useState, useRef } from "react";
import { useSidebarTabs, type SidebarTabsConfig } from "@/hooks/useSidebarTabs";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import {
  Download,
  RefreshCw,
  Bot,
  CheckCircle,
  Database,
  Trash2,
  Eye,
  Monitor,
  Upload,
  Terminal,
  ArrowLeftRight,
  Copy,
  Check,
  Settings as SettingsIcon,
  Layers,
  FolderOpen,
  FileCog,
  AppWindow,
  Binary,
  Sparkles,
  AlertCircle,
  ArrowUpCircle,
  ExternalLink,
  Home,
  BookOpen,
  ListChecks,
  PenTool,
  Sliders,
  ToggleLeft,
  ToggleRight,
  Mic,
  X,
  Globe,
  Sun,
  Moon,
  Palette,
} from "lucide-react";
import { ClearVectorConfirmDialog } from "./ClearVectorConfirmDialog";
import { ImportDatabaseConfirmDialog } from "./ImportDatabaseConfirmDialog";
import { cn } from "@/lib/utils";

// 仅作为输入框 placeholder 提示，不做自动填充
//
// 两种协议的路径要求正好相反（详见主进程 resolveBaseUrl 的注释）：
//   OpenAI 格式  → baseUrl 必须带 /v1      → https://api.minimax.cn/v1
//   Claude 格式  → baseUrl 不能带 /v1      → https://api.minimax.cn/anthropic
// 注意 claude 这行以前写的是 https://api.anthropic.com/v1，而 Anthropic SDK
// 会自己追加完整的 /v1/messages，照着填会打成 /v1/v1/messages。
const AI_PROTOCOL_HINTS: Record<string, { url: string; model: string }> = {
  openai: {
    url: "https://api.minimax.cn/v1",
    model: "如 MiniMax-M3、deepseek-chat、gpt-4o-mini 等",
  },
  claude: {
    url: "https://api.minimax.cn/anthropic",
    model: "如 MiniMax-M3、claude-3-5-haiku-20241022 等",
  },
};

// Helper: trigger save-flash + 持久的"已保存"反馈
// 950ms 闪动画 + 3s "已保存"徽章淡入淡出
function triggerSaveFlash(setter: (v: boolean) => void) {
  setter(true);
  setTimeout(() => setter(false), 3000);
}

// 主题色系统（降噪版） —— 之前 6 套强调色让设置页像万花筒，
// 现在收敛到 2 套：accent（强调配置卡）+ neutral（中性 / 工具卡）
// Tailwind JIT 不支持动态字符串拼接 class，所以这里做静态映射
type AccentKey = "accent" | "neutral";

export interface AccentSpec {
  iconText: string;
  /** 图标背景 — 平面 tint，去掉了 from-X to-X 多重渐变（AI 调色板的标志） */
  iconBg: string;
  iconBorder: string;
  /** 状态徽章（已配置 / 成功） */
  badge: string;
  badgeDot: string;
  /** 闲置徽章 */
  badgeIdle: string;
  badgeIdleDot: string;
  sectionIcon: string;
  hoverBorder: string;
}

export const ACCENTS: Record<AccentKey, AccentSpec> = {
  /** 强调配置卡 — OCR / AI / 侧边栏设置 */
  accent: {
    iconText: "text-primary",
    iconBg: "bg-primary/10",
    iconBorder: "ring-1 ring-primary/20",
    badge: "bg-primary/10 text-primary border-primary/25",
    badgeDot: "bg-primary",
    badgeIdle: "bg-muted text-muted-foreground/70 border-border/70",
    badgeIdleDot: "bg-muted-foreground/40",
    sectionIcon: "text-primary",
    hoverBorder: "hover:border-primary/40 focus-within:border-primary/40",
  },
  /** 中性 / 工具卡 — 记忆索引 / 数据迁移 / 开发者工具 / 应用信息 */
  neutral: {
    iconText: "text-muted-foreground",
    iconBg: "bg-muted",
    iconBorder: "ring-1 ring-border",
    badge: "bg-muted text-muted-foreground border-border",
    badgeDot: "bg-muted-foreground",
    badgeIdle: "bg-muted/60 text-muted-foreground/60 border-border/60",
    badgeIdleDot: "bg-muted-foreground/30",
    sectionIcon: "text-muted-foreground",
    hoverBorder: "hover:border-muted-foreground/30 focus-within:border-muted-foreground/30",
  },
};

/**
 * 配置状态徽章 — 已配置 / 未配置指示器
 * configured: true 用 accent.badge（强调色），false 用 accent.badgeIdle（中性灰）
 */
function ConfigStatus({
  configured,
  label,
  accent,
}: {
  configured: boolean;
  label?: string;
  accent: AccentSpec;
}) {
  const text = label ?? (configured ? "已配置" : "未配置");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md shrink-0 border transition-colors duration-150",
        configured ? accent.badge : accent.badgeIdle
      )}
      title={configured ? "已配置" : "尚未配置"}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          configured ? accent.badgeDot : accent.badgeIdleDot
        )}
      />
      {text}
    </span>
  );
}

/**
 * 设置页分区 — 左侧导航项
 *
 * 分组依据：把「AI 用量」从「数据与应用」挪到「服务与 AI」（它讲的是 AI 的花销，
 * 不是数据管理），让三个分区的卡片数变成 4 / 3 / 1，不再是一个只有单卡的空分区。
 */
export type SettingsSection = "service" | "data" | "ui";

const SETTINGS_SECTION_KEY = "qnote-settings-section";

function loadSettingsSection(): SettingsSection {
  try {
    const raw = localStorage.getItem(SETTINGS_SECTION_KEY);
    if (raw === "service" || raw === "data" || raw === "ui") return raw;
  } catch {
    // localStorage 不可用时回落默认分区
  }
  return "service";
}

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}> = [
  { id: "service", label: "服务与 AI", icon: Bot, hint: "OCR、AI 端点、记忆索引、用量" },
  { id: "data", label: "数据与开发", icon: Layers, hint: "迁移、开发者工具、应用信息" },
  { id: "ui", label: "界面", icon: Sliders, hint: "外观主题与侧边栏入口" },
];

/** 外观主题三档选项 */
const THEME_OPTIONS: Array<{
  value: Theme;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

const THEME_LABELS: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

/**
 * 左侧分区导航 — 粘性定位，滚动时始终可见
 */
function SettingsSectionNav({
  active,
  onSelect,
}: {
  active: SettingsSection;
  onSelect: (next: SettingsSection) => void;
}) {
  return (
    <nav className="sticky top-4 w-[200px] shrink-0 space-y-1" aria-label="设置分区">
      {SETTINGS_SECTIONS.map((section) => {
        const isActive = section.id === active;
        const Icon = section.icon;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "w-full text-left rounded-lg px-3 py-2.5 border transition-colors",
              isActive
                ? "bg-primary/10 border-primary/25 text-foreground"
                : "border-transparent hover:bg-muted/50 text-muted-foreground"
            )}
          >
            <span className="flex items-center gap-2">
              <Icon
                className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "opacity-70")}
              />
              <span className="text-[13px] font-medium">{section.label}</span>
            </span>
            <span className="block text-[11px] leading-relaxed mt-1 opacity-70">
              {section.hint}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * SettingsCard — 卡片容器 + hover 描边色
 * 主题色靠图标容器、状态徽章、hover 描边传递，不需要左侧色条
 */
export function SettingsCard({
  accent,
  className,
  children,
}: {
  accent: AccentSpec;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "settings-card-hover relative overflow-hidden border-border/70",
        accent.hoverBorder,
        className
      )}>
      {children}
    </Card>
  );
}

/**
 * SettingsCardHeader — 大图标方块 + 标题 + 副标题 + 状态徽章
 */
export function SettingsCardHeader({
  accent,
  icon: Icon,
  title,
  subtitle,
  status,
}: {
  accent: AccentSpec;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  status?: React.ReactNode;
}) {
  return (
    <div className="px-5 pt-5 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
              accent.iconBg,
              accent.iconBorder
            )}>
            <Icon className={cn("h-5 w-5", accent.iconText)} />
          </div>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-[15px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h3>
            <p className="text-xs text-muted-foreground/75 leading-snug mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
        {status && <div className="shrink-0 mt-0.5">{status}</div>}
      </div>
    </div>
  );
}

/**
 * 表单字段 — 标签 + 输入框 + 可选 helper text
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground/80 block">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

// ============================================================
// AI 用量统计 UI 组件
// ============================================================

type UsageTotals = {
  calls: number;
  llmCalls: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  errorCount: number;
  errorRate: number;
};

type UsageByModel = {
  provider: string;
  model: string;
  calls: number;
  totalTokens: number;
  avgLatencyMs: number;
  errorCount: number;
};

type UsageByDay = { date: string; calls: number; totalTokens: number; errorCount: number };

type UsageRecordRow = {
  id: number;
  provider: string;
  model: string;
  kind: string;
  agentIteration: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  success: boolean;
  errorType: string;
  errorMessage: string;
  sessionId: string | null;
  createdAt: string;
};

type UsageStats = {
  today: UsageTotals;
  week: UsageTotals;
  all: UsageTotals;
  byModel: UsageByModel[];
  byDay: UsageByDay[];
  recent: UsageRecordRow[];
};

/** 1234567 → "1.23M"（token 数太大，可读性优先） */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/** 单个统计格 */
function UsageStatCell({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "destructive" | "success";
}) {
  return (
    <div className="rounded-md bg-muted/30 border border-border/50 px-3 py-2">
      <div className="text-[10px] text-muted-foreground/70 leading-tight">{label}</div>
      <div
        className={cn(
          "text-[15px] font-semibold tabular-nums leading-tight mt-0.5",
          tone === "destructive"
            ? "text-destructive"
            : tone === "success"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-foreground/90"
        )}>
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-muted-foreground/60 leading-tight mt-0.5">
          {hint}
        </div>
      )}
    </div>
  );
}

/** 14 天趋势迷你柱状图（纯 div，无图表库） */
function UsageTrendChart({ data }: { data: UsageByDay[] }) {
  if (data.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/60 py-4 text-center">
        暂无数据
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.calls), 1);

  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-[3px] h-16">
        {data.map((d) => {
          const h = Math.max(4, (d.calls / max) * 60);
          return (
            <div
              key={d.date}
              className="flex-1 min-w-[3px] group relative"
              title={`${d.date}：${d.calls} 次调用，${formatTokens(d.totalTokens)} tokens`}
            >
              <div
                className="w-full rounded-t-[2px] bg-primary/25 group-hover:bg-primary/45 transition-colors"
                style={{ height: `${h}px` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/55">
        <span>{data[0]?.date.slice(5)}</span>
        <span>最近 {data.length} 天 · 峰值 {max} 次</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

// ============================================================
// Skill：AI 技能管理 UI 组件
// ============================================================

export default function Settings() {
  /** 主题 — 全局 store，设置页只是它的一个视图 */
  const { theme, setTheme } = useTheme();

  /** 当前分区 — 记住上次停留的位置，重进设置页不用从头找 */
  const [activeSection, setActiveSectionState] = useState<SettingsSection>(loadSettingsSection);
  const setActiveSection = useCallback((next: SettingsSection) => {
    setActiveSectionState(next);
    try {
      localStorage.setItem(SETTINGS_SECTION_KEY, next);
    } catch {
      // localStorage 不可用时仅本次会话有效
    }
  }, []);

  const [apiKey, setApiKey] = useState<string>("");
  const [secretKey, setSecretKey] = useState<string>("");

  // AI配置相关state
  const [aiProvider, setAiProvider] = useState<string>("openai");
  const [aiApiKey, setAiApiKey] = useState<string>("");
  const [aiModel, setAiModel] = useState<string>("");
  const [aiBaseUrl, setAiBaseUrl] = useState<string>("");
  const [isValidatingAi, setIsValidatingAi] = useState(false);

  // 记忆索引相关state
  const [vectorCount, setVectorCount] = useState<number>(0);
  const prevVectorCountRef = useRef<number>(0);
  const [isClearingVector, setIsClearingVector] = useState(false);
  const [clearVectorDialogOpen, setClearVectorDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [isExportingDb, setIsExportingDb] = useState(false);
  const [isImportingDb, setIsImportingDb] = useState(false);
  const [appInfo, setAppInfo] = useState<{
    dataPath: string;
    configPath: string;
    version: string;
    appPath: string;
    exePath: string;
  } | null>(null);

  // Save success flash states
  const [ocrSaved, setOcrSaved] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);

  // AI 用量统计
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const [clearingUsage, setClearingUsage] = useState(false);

  // Path copy feedback state
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const handleCopyPath = async (path: string, label: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      toast({ title: `${label}已复制` });
      setTimeout(() => setCopiedPath(null), 2000);
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  };

  // 侧边栏标签显示配置
  const [sidebarTabs, setSidebarTabs] = useSidebarTabs();

  const loadBaiduKeys = async () => {
    try {
      const keys = await window.electron.getBaiduKeys();
      setApiKey(keys.apiKey || "");
      setSecretKey(keys.secretKey || "");
    } catch (_error) {
      console.error("加载百度OCR密钥失败:", _error);
      toast({
        title: "加载配置失败",
        variant: "destructive",
      });
    }
  };

  const loadAppInfo = async () => {
    try {
      const info = await window.electron.getAppInfo();
      setAppInfo(info);
    } catch (_error) {
      console.error("加载应用信息失败:", _error);
    }
  };

  const loadAiConfig = async () => {
    try {
      const config = await window.electron.getAiConfig();      // 老数据兼容：provider="deepseek" 走 OpenAI 协议，且默认 URL 填回 DeepSeek 官方端点
      let provider = config.provider || "openai";
      let baseUrl = config.baseUrl || "";
      if (provider === "deepseek") {
        provider = "openai";
        if (!baseUrl) {
          baseUrl = "https://api.deepseek.com/v1/chat/completions";
        }
      }
      setAiProvider(provider);
      setAiApiKey(config.apiKey || "");
      setAiModel(config.model || "");
      setAiBaseUrl(baseUrl);
    } catch (_error) {
      console.error("加载AI配置失败:", _error);
    }
  };

  /** 读取当前生效的语音快捷键 */
  const loadVoiceHotkey = async () => {
    try {
      const result = await window.electron.getVoiceHotkey();
      if (result.ok && result.accelerator) {
        setVoiceHotkey(result.accelerator);
        setVoiceHotkeyInput(result.accelerator);
      }
    } catch (err) {
      console.error("加载语音快捷键失败:", err);
    }
  };

  // 加载用量统计
  const loadUsageStats = async () => {    setUsageLoading(true);
    try {
      const stats = await window.electron.getAiUsageStats();
      setUsageStats(stats);
    } catch (err) {
      console.error("加载AI用量统计失败:", err);
    } finally {
      setUsageLoading(false);
    }
  };

  // 清空用量记录
  const handleClearUsageLog = async () => {
    setClearingUsage(true);
    try {
      const result = await window.electron.clearAiUsageLog();
      if (result.success) {
        toast({ title: `已清空 ${result.deleted ?? 0} 条用量记录` });
        await loadUsageStats();
      } else {
        toast({ title: "清空失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "清空失败", variant: "destructive" });
    } finally {
      setClearingUsage(false);
    }
  };

  const loadMemoryCount = async () => {
    try {
      const result = await window.electron.getMemoryCount();
      if (result.success && result.count !== undefined) {
        setVectorCount(result.count);
      }
    } catch (err) {
      console.error("加载记忆索引数量失败:", err);
    }
  };

  const handleClearMemoryStore = () => {
    setClearVectorDialogOpen(true);
  };

  const handleClearVectorDialogConfirm = async () => {
    setClearVectorDialogOpen(false);
    setIsClearingVector(true);
    try {
      const result = await window.electron.clearMemoryStore();
      if (result.success) {
        toast({
          title: "记忆索引已清空",
        });
        await loadMemoryCount();
      } else {
        toast({
          title: "清空失败",
          description: result.error?.includes("UniqueConstraintError")
            ? "数据库约束错误，请稍后重试"
            : result.error || "本地记忆索引暂不可用",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("清空记忆索引失败:", err);
      toast({
        title: "操作失败",
        description: "本地记忆索引暂不可用",
        variant: "destructive",
      });
    } finally {
      setIsClearingVector(false);
    }
  };

  const handleExportDatabase = async () => {
    setIsExportingDb(true);
    try {
      const result = await window.electron.exportDatabase();
      if (result?.success) {
        toast({
          title: "数据库导出成功",
          description: `文件已保存到：${result.filePath}`,
        });
      } else if (!result?.canceled) {
        toast({
          title: "导出失败",
          description: result?.error || "未知错误",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("导出数据库失败", error);
      toast({
        title: "导出失败",
        description: "写入文件时发生错误",
        variant: "destructive",
      });
    } finally {
      setIsExportingDb(false);
    }
  };

  const handleImportDatabase = () => {
    setImportDialogOpen(true);
  };

  const handleImportDialogConfirm = async () => {
    setImportDialogOpen(false);
    setIsImportingDb(true);
    try {
      const result = await window.electron.importDatabase();
      if (result?.success) {
        toast({
          title: "数据库导入完成",
          description: "数据已覆盖完成，建议立即重启应用以加载新数据",
        });
      } else if (!result?.canceled) {
        toast({
          title: "导入失败",
          description: result?.error || "未知错误",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("导入数据库失败", error);
      toast({
        title: "导入失败",
        description: "读取或写入文件时发生错误",
        variant: "destructive",
      });
    } finally {
      setIsImportingDb(false);
    }
  };

  useEffect(() => {
    loadBaiduKeys();
    loadAppInfo();
    loadAiConfig();
    loadMemoryCount();
    loadUsageStats();
    void loadVoiceHotkey();
  }, []);

  // Detect vectorCount changes and trigger spring pop animation on badge
  const [vectorBadgePop, setVectorBadgePop] = useState(false);
  useEffect(() => {
    if (vectorCount !== prevVectorCountRef.current && vectorCount > 0) {
      prevVectorCountRef.current = vectorCount;
      setVectorBadgePop(true);
      const t = setTimeout(() => setVectorBadgePop(false), 600);
      return () => clearTimeout(t);
    }
    prevVectorCountRef.current = vectorCount;
  }, [vectorCount]);

  const handleSaveKeys = async () => {
    try {
      const result = await window.electron.setBaiduKeys(apiKey, secretKey);
      if (result.success) {
        toast({ title: "百度OCR密钥已保存" });
        triggerSaveFlash(setOcrSaved);
      } else {
        toast({
          title: "保存失败",
          description: result.error,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "保存失败",
        description: "网络错误或配置无效",
        variant: "destructive",
      });
    }
  };

  const handleSaveAiConfig = async () => {
    try {
      const result = await window.electron.setAiConfig(
        aiProvider,
        aiApiKey,
        aiModel,
        aiBaseUrl
      );
      if (result) {
        toast({ title: "AI配置已保存" });
        triggerSaveFlash(setAiSaved);
      } else {
        toast({
          title: "保存失败",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "保存失败",
        description: "配置无效",
        variant: "destructive",
      });
    }
  };

  const handleValidateAiConfig = async () => {
    if (!aiApiKey.trim()) {
      toast({
        title: "请输入API Key",
        variant: "destructive",
      });
      return;
    }

    setIsValidatingAi(true);
    try {
      const isValid = await window.electron.validateAiConfig(
        aiProvider,
        aiApiKey,
        aiModel,
        aiBaseUrl
      );
      if (isValid) {
        toast({
          title: "配置验证成功",
          description: "API Key有效，可以正常使用AI功能",
        });
      } else {
        toast({
          title: "配置验证失败",
          description: "请检查API Key是否正确",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "验证失败",
        description: "网络错误或配置无效",
        variant: "destructive",
      });
    } finally {
      setIsValidatingAi(false);
    }
  };

  // 用于页面顶部"配置状态"概览
  const ocrConfigured = !!(apiKey && secretKey);
  const aiConfigured = !!(aiApiKey && aiModel);

  // ============================================================
  // 语音输入
  // ============================================================

  const [voiceHotkey, setVoiceHotkey] = useState("");
  const [voiceHotkeyInput, setVoiceHotkeyInput] = useState("");
  const [isSavingVoice, setIsSavingVoice] = useState(false);
  /** 最近一次保存结果；null = 还没保存过 */
  const [voiceHotkeyStatus, setVoiceHotkeyStatus] = useState<
    { tone: "success" | "destructive"; message: string } | null
  >(null);

  // 快捷键预设：只保留 F1。
  //
  // F1 专门对应笔记本的 Fn+1 —— Fn 键本身到不了应用层，但多数笔记本开着
  // 「Fn 作为功能键」时，会由驱动把 Fn+1 映射成 F1 送给系统。
  //
  // 只留这一个是有意的：带修饰键的组合要用户自己判断与既有快捷键的关系
  // （Ctrl+Shift+V 是剪贴板小窗、Ctrl+Shift+A 曾是旧 AI 弹窗），而 F1 落在
  // 功能键区、几乎不会和别的软件撞键，是「按一下就开始录音」最不容易失败的
  // 选择。accelerator 输入框仍然保留，需要别的组合直接手填即可。
  const VOICE_HOTKEY_PRESETS: Array<{ label: string; value: string; hint?: string }> = [
    { label: "F1（笔记本 Fn+1）", value: "F1", hint: "需驱动已把 Fn 映射为功能键" },
  ];

  const handleSaveVoiceHotkey = async () => {
    const accelerator = voiceHotkeyInput.trim();
    if (!accelerator) {
      setVoiceHotkeyStatus({ tone: "destructive", message: "快捷键不能为空" });
      return;
    }
    setIsSavingVoice(true);
    try {
      const result = await window.electron.setVoiceHotkey(accelerator);
      if (result.ok) {
        setVoiceHotkey(accelerator);
        setVoiceHotkeyStatus({ tone: "success", message: "已生效" });
        toast({ title: "语音快捷键已保存", description: `按 ${accelerator} 即可语音输入` });
      } else {
        // 主进程在注册失败时会回滚到默认组合，所以这里把回滚后的值读回来，
        // 否则输入框会停留在一个其实没生效的组合上。
        const current = await window.electron.getVoiceHotkey();
        if (current.ok && current.accelerator) {
          setVoiceHotkey(current.accelerator);
          setVoiceHotkeyInput(current.accelerator);
        }
        setVoiceHotkeyStatus({
          tone: "destructive",
          message: result.error || "注册失败",
        });
      }
    } catch (err) {
      setVoiceHotkeyStatus({
        tone: "destructive",
        message: err instanceof Error ? err.message : "保存失败",
      });
    } finally {
      setIsSavingVoice(false);
    }
  };

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <div className="max-w-6xl mx-auto w-full">
        {/* === Page Hero === */}
        {/* 标题在左，副标题与状态芯片靠右对齐 ——
            之前都堆在标题下方，把首屏内容整体往下推了一截 */}
        <div className="mb-8 sm:mb-10 flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
            <SettingsIcon className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight leading-tight shrink-0">
            设置
          </h1>
          <div className="flex-1 min-w-0 flex flex-col items-end gap-3">
            <p className="text-sm text-muted-foreground/80 leading-relaxed text-right">
              管理应用程序的各项服务配置、数据管理与版本信息
            </p>
            {/* 配置状态小芯片 — 让用户一眼看到整体配置完成度 */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StatusChip
                accent={ACCENTS.accent}
                label="OCR 识别"
                configured={ocrConfigured}
              />
              <StatusChip
                accent={ACCENTS.accent}
                label="AI 助手"
                configured={aiConfigured}
              />
              <StatusChip
                accent={ACCENTS.accent}
                label="记忆索引"
                configured={vectorCount > 0}
              />
            </div>
          </div>
        </div>

        {/* 分区导航 + 单分区内容
            早期版本把 8 张卡片平铺成一条超长列表，分区之间只有一行小标题，
            滚动时没有任何位置感。改为左侧粘性导航，一次只渲染当前分区。 */}
        <div className="flex items-start gap-6">
          <SettingsSectionNav active={activeSection} onSelect={setActiveSection} />

          <div className="flex-1 min-w-0">
            {activeSection === "service" && (
              <div className="grid grid-cols-1 gap-5 settings-grid">
            {/* OCR配置 */}
            <SettingsCard accent={ACCENTS.accent}>
              <SettingsCardHeader
                accent={ACCENTS.accent}
                icon={Eye}
                title="OCR识别"
                subtitle="百度 OCR 文字识别 API 密钥"
                status={
                  <ConfigStatus
                    configured={ocrConfigured}
                    accent={ACCENTS.accent}
                  />
                }
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-4">
                <Field label="API Key">
                  <Input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="请输入API Key"
                    className="h-9 bg-muted/30 focus-visible:bg-background"
                  />
                </Field>
                <Field label="Secret Key">
                  <Input
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder="请输入Secret Key"
                    className="h-9 bg-muted/30 focus-visible:bg-background"
                  />
                </Field>
                <div className="relative">
                  <Button
                    onClick={handleSaveKeys}
                    className={cn(
                      "w-full h-9 btn-hover",
                      ocrSaved && "save-flash"
                    )}>
                    <CheckCircle className="h-4 w-4 mr-1.5" />
                    保存配置
                  </Button>
                  {/* 持久保存反馈 — 绝对定位，不占用按钮空间，保存后浮在按钮右内侧 */}
                  <span
                    className={cn(
                      "absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border transition-all duration-300 pointer-events-none",
                      ocrSaved
                        ? "opacity-100 translate-x-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                        : "opacity-0 -translate-x-2 border-transparent"
                    )}
                    aria-live="polite">
                    <Check className="h-3 w-3" />
                    已保存
                  </span>
                </div>
              </CardContent>
            </SettingsCard>
            {/* AI助手配置 */}
            <SettingsCard accent={ACCENTS.accent}>
              <SettingsCardHeader
                accent={ACCENTS.accent}
                icon={Bot}
                title="AI助手"
                subtitle="自定义 LLM 端点、协议与模型"
                status={
                  <ConfigStatus
                    configured={aiConfigured}
                    accent={ACCENTS.accent}
                  />
                }
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-4">
                <Field label="API 协议">
                  <select
                    className="w-full h-9 border border-input rounded-md px-3 text-sm bg-muted/30 hover:bg-muted/50 focus:bg-background hover:border-muted-foreground/35 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-colors duration-150 cursor-pointer input-focus"
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}>
                    <option value="openai">OpenAI 格式</option>
                    <option value="claude">Claude 格式</option>
                  </select>
                </Field>
                <Field
                  label="API 端点"
                  hint={
                    <>
                      留空使用官方默认。两种协议对路径的要求相反：OpenAI
                      格式要带{" "}
                      <span className="font-mono text-foreground/70">/v1</span>
                      （如{" "}
                      <span className="font-mono text-foreground/70">
                        https://api.minimax.cn/v1
                      </span>
                      ），Claude 格式不能带（如{" "}
                      <span className="font-mono text-foreground/70">
                        https://api.minimax.cn/anthropic
                      </span>
                      ）。也可直接贴完整路径，服务会自动识别并补全。切换协议时记得
                      同步改这里，否则请求会打到不存在的地址。
                    </>
                  }>
                  <Input
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    placeholder={AI_PROTOCOL_HINTS[aiProvider]?.url || "请输入 API 端点 URL"}
                    className="h-9 bg-muted/30 focus-visible:bg-background"
                  />
                </Field>
                <Field label="API Key">
                  <Input
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="请输入 API Key"
                    className="h-9 bg-muted/30 focus-visible:bg-background"
                  />
                </Field>
                <Field label="模型">
                  <Input
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder={AI_PROTOCOL_HINTS[aiProvider]?.model || "请输入模型名称"}
                    className="h-9 bg-muted/30 focus-visible:bg-background"
                  />
                </Field>
                {/* 「已保存」提示改成绝对定位：它哪怕 opacity-0 仍然占布局宽度，
                    会把两个 flex-1 按钮挤窄，右边留出一条空白 */}
                <div className="relative">
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={handleValidateAiConfig}
                      disabled={!aiApiKey.trim() || isValidatingAi}
                      variant="outline"
                      className="flex-1 h-9 btn-hover">
                      {isValidatingAi ? (
                        <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4 mr-1.5" />
                      )}
                      {isValidatingAi ? "验证中..." : "验证"}
                    </Button>
                    <Button
                      onClick={handleSaveAiConfig}
                      className={cn(
                        "flex-1 h-9 btn-hover",
                        aiSaved && "save-flash"
                      )}>
                      保存
                    </Button>
                  </div>
                  {/* 持久保存反馈 — 保存后显示 3 秒再淡出 */}
                  <span
                    className={cn(
                      "absolute right-3 top-[22px] -translate-y-1/2 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border transition-all duration-300 pointer-events-none",
                      aiSaved
                        ? "opacity-100 translate-x-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                        : "opacity-0 -translate-x-2 border-transparent"
                    )}
                    aria-live="polite">
                    <Check className="h-3 w-3" />
                    已保存
                  </span>
                </div>
              </CardContent>
            </SettingsCard>
            {/* 语音输入 */}
            <SettingsCard accent={ACCENTS.accent}>
              <SettingsCardHeader
                accent={ACCENTS.accent}
                icon={Mic}
                title="语音输入"
                subtitle="收起为宠物时用快捷键说话，AI 回复显示在宠物气泡里"
                status={
                  voiceHotkey ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                      {voiceHotkey}
                    </span>
                  ) : undefined
                }
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-4">
                <Field
                  label="全局快捷键"
                  hint={
                    <>
                      按一次开始录音，再按一次结束并提问。识别使用
                      <span className="font-mono text-foreground/70">
                        {" "}
                        MiniMax ASR
                      </span>
                      ，凭据复用上方「AI助手」的 API Key；识别端点固定为 MiniMax
                      官方的 speech_to_text，与对话端点的路径无关。
                      <br />
                      注意：Electron
                      不支持 fn 键（它被键盘驱动拦截、到不了应用）。
                      笔记本若已把 Fn+1 映射为功能键，请填
                      <span className="font-mono text-foreground/70">F1</span>。
                    </>
                  }>
                  <Input
                    value={voiceHotkeyInput}
                    onChange={(e) => {
                      setVoiceHotkeyInput(e.target.value);
                      setVoiceHotkeyStatus(null);
                    }}
                    placeholder="F1"
                    spellCheck={false}
                    className="h-9 bg-muted/30 font-mono focus-visible:bg-background"
                  />
                </Field>

                {/* 快捷键预设：省得用户去记 accelerator 的确切拼写 */}
                <div className="flex flex-wrap gap-1.5">
                  {VOICE_HOTKEY_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      title={preset.hint}
                      onClick={() => {
                        setVoiceHotkeyInput(preset.value);
                        setVoiceHotkeyStatus(null);
                      }}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-[11px] transition-colors",
                        "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        voiceHotkey === preset.value && "border-primary/50 bg-primary/10 text-primary"
                      )}>
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={handleSaveVoiceHotkey}
                      disabled={isSavingVoice || !voiceHotkeyInput.trim()}
                      className="flex-1 h-9 btn-hover">
                      {isSavingVoice ? "保存中…" : "保存快捷键"}
                    </Button>
                  </div>
                  {voiceHotkeyStatus && (
                    <p
                      className={cn(
                        "mt-2 text-[11px] leading-relaxed",
                        voiceHotkeyStatus.tone === "success"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                      )}
                      aria-live="polite">
                      {voiceHotkeyStatus.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </SettingsCard>
            {/* 本地记忆索引 */}
            <SettingsCard accent={ACCENTS.accent}>
              <SettingsCardHeader
                accent={ACCENTS.accent}
                icon={Database}
                title="本地记忆索引"
                subtitle="本地关键词与时间权重召回"
                status={
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs font-bold text-amber-700 dark:text-amber-300",
                      vectorBadgePop && "vector-badge-pop"
                    )}>
                    {vectorCount}
                  </span>
                }
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-4">
                <div className="rounded-lg bg-muted/40 border border-border/60 px-4 py-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground/80">
                      已索引记录数
                    </span>
                    <span
                      className={cn(
                        "stat-number-badge",
                        vectorBadgePop && "vector-badge-pop"
                      )}>
                      {vectorCount}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    使用本地记忆摘要、关键词和时间权重进行内容召回，不再依赖外部向量服务
                  </p>
                </div>
                <Button
                  onClick={handleClearMemoryStore}
                  disabled={isClearingVector}
                  variant="destructive"
                  className="w-full h-9 btn-delete-hover">
                  {isClearingVector ? (
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1.5" />
                  )}
                  {isClearingVector ? "清空中..." : "清空记忆索引"}
                </Button>
              </CardContent>
            </SettingsCard>
            {/* AI 用量统计 */}
            <SettingsCard accent={ACCENTS.neutral}>
              <SettingsCardHeader
                accent={ACCENTS.neutral}
                icon={Sparkles}
                title="AI 用量"
                subtitle="Token 消耗、调用延迟与错误率"
                status={
                  usageStats && usageStats.all.calls > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground border-border">
                      {usageStats.all.calls} 次调用
                    </span>
                  ) : null
                }
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-4">
                {usageLoading && !usageStats ? (
                  <p className="text-[11px] text-muted-foreground/60 py-4 text-center">
                    加载中…
                  </p>
                ) : !usageStats || usageStats.all.calls === 0 ? (
                  <div className="rounded-lg bg-muted/30 border border-border/60 px-4 py-6 text-center">
                    <p className="text-[13px] text-muted-foreground/75">
                      还没有 AI 调用记录
                    </p>
                    <p className="text-[11px] text-muted-foreground/55 mt-1">
                      与 AI 对话后，这里会显示 token 消耗和延迟统计
                    </p>
                  </div>
                ) : (
                  <>
                    {/* 汇总三档 */}
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ["今日", usageStats.today],
                          ["本周", usageStats.week],
                          ["全部", usageStats.all],
                        ] as const
                      ).map(([label, t]) => (
                        <div
                          key={label}
                          className="rounded-md bg-muted/30 border border-border/50 px-3 py-2">
                          <div className="text-[10px] text-muted-foreground/70 leading-tight">
                            {label}
                          </div>
                          <div className="text-[15px] font-semibold tabular-nums leading-tight mt-0.5 text-foreground/90">
                            {formatTokens(t.totalTokens)}
                          </div>
                          <div className="text-[10px] text-muted-foreground/60 leading-tight mt-0.5">
                            tokens · {t.calls} 次
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 关键指标 */}
                    <div className="grid grid-cols-2 gap-2">
                      <UsageStatCell
                        label="平均延迟"
                        value={
                          usageStats.all.avgLatencyMs >= 1000
                            ? (usageStats.all.avgLatencyMs / 1000).toFixed(2) + "s"
                            : usageStats.all.avgLatencyMs + "ms"
                        }
                        hint={`${usageStats.all.llmCalls} 次 LLM · ${usageStats.all.toolCalls} 次工具`}
                      />
                      <UsageStatCell
                        label="错误率"
                        value={(usageStats.all.errorRate * 100).toFixed(1) + "%"}
                        hint={`${usageStats.all.errorCount} 次失败`}
                        tone={
                          usageStats.all.errorRate > 0.1
                            ? "destructive"
                            : usageStats.all.errorCount === 0
                              ? "success"
                              : "default"
                        }
                      />
                    </div>

                    {/* 趋势 */}
                    <div className="rounded-lg bg-muted/30 border border-border/60 px-4 py-3">
                      <div className="text-[11px] text-muted-foreground/75 mb-2">
                        调用趋势
                      </div>
                      <UsageTrendChart data={usageStats.byDay} />
                    </div>

                    {/* 按模型分布 */}
                    {usageStats.byModel.length > 0 && (
                      <div className="rounded-lg bg-muted/30 border border-border/60 px-4 py-3">
                        <div className="text-[11px] text-muted-foreground/75 mb-2">
                          按模型分布
                        </div>
                        <div className="space-y-1.5">
                          {usageStats.byModel.map((m) => {
                            const pct =
                              usageStats.all.llmCalls > 0
                                ? (m.calls / usageStats.all.llmCalls) * 100
                                : 0;
                            return (
                              <div key={`${m.provider}/${m.model}`} className="space-y-0.5">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-foreground/80 font-mono truncate mr-2">
                                    {m.model}
                                  </span>
                                  <span className="text-muted-foreground/65 tabular-nums shrink-0">
                                    {m.calls} 次 · {formatTokens(m.totalTokens)}
                                  </span>
                                </div>
                                <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-primary/40"
                                    style={{ width: `${Math.max(2, pct)}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 最近记录（折叠） */}
                    {usageStats.recent.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setUsageExpanded((v) => !v)}
                          className="text-[11px] text-muted-foreground/70 hover:text-foreground/90 transition-colors flex items-center gap-1">
                          {usageExpanded ? "收起" : "展开"}最近 {usageStats.recent.length} 条记录
                          <span className="text-[9px]">
                            {usageExpanded ? "▲" : "▼"}
                          </span>
                        </button>

                        {usageExpanded && (
                          <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border/50 divide-y divide-border/40">
                            {usageStats.recent.map((r) => (
                              <div
                                key={r.id}
                                className="flex items-center gap-2 px-2.5 py-1.5 text-[10px]"
                              >
                                <span
                                  className={cn(
                                    "w-1.5 h-1.5 rounded-full shrink-0",
                                    r.success ? "bg-emerald-500" : "bg-destructive"
                                  )}
                                />
                                <span className="text-muted-foreground/55 tabular-nums shrink-0 w-24">
                                  {new Date(r.createdAt).toLocaleString("zh-CN", {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                <span className="font-mono text-foreground/70 truncate flex-1">
                                  {r.kind === "tool" ? `[${r.model}]` : r.model}
                                </span>
                                <span className="text-muted-foreground/55 tabular-nums shrink-0">
                                  {r.kind === "tool"
                                    ? `${r.latencyMs}ms`
                                    : `${formatTokens(r.totalTokens)} · ${r.latencyMs}ms`}
                                </span>
                                {!r.success && r.errorType && (
                                  <span className="text-destructive/80 shrink-0">
                                    {r.errorType}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={loadUsageStats}
                        disabled={usageLoading}
                        variant="outline"
                        className="flex-1 h-8 text-[12px] btn-hover"
                      >
                        <RefreshCw
                          className={cn("h-3.5 w-3.5 mr-1.5", usageLoading && "animate-spin")}
                        />
                        刷新
                      </Button>
                      <Button
                        onClick={handleClearUsageLog}
                        disabled={clearingUsage}
                        variant="destructive"
                        className="flex-1 h-8 text-[12px] btn-delete-hover"
                      >
                        {clearingUsage ? (
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        清空记录
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </SettingsCard>
              </div>
            )}

            {activeSection === "data" && (
              <div className="grid grid-cols-1 gap-5 settings-grid">
            {/* 数据迁移 */}
            <SettingsCard accent={ACCENTS.neutral}>
              <SettingsCardHeader
                accent={ACCENTS.neutral}
                icon={ArrowLeftRight}
                title="数据迁移"
                subtitle="导出或导入数据库用于设备间迁移"
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-3">
                <p className="text-[13px] text-muted-foreground/80 leading-relaxed">
                  导出或导入整个数据库，以便在不同设备之间迁移。
                </p>
                <Button
                  onClick={handleExportDatabase}
                  disabled={isExportingDb}
                  className="w-full h-9 btn-hover">
                  {isExportingDb ? (
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  {isExportingDb ? "导出中..." : "导出数据库"}
                </Button>
                <Button
                  onClick={handleImportDatabase}
                  variant="destructive"
                  disabled={isImportingDb}
                  className="w-full h-9 btn-delete-hover">
                  {isImportingDb ? (
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-1.5" />
                  )}
                  {isImportingDb ? "导入中..." : "导入数据库"}
                </Button>
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
                  提示：导入操作会覆盖当前数据并需要重启应用。建议先执行导出做备份。
                </p>
              </CardContent>
            </SettingsCard>
            {/* 开发者工具 */}
            <SettingsCard accent={ACCENTS.neutral}>
              <SettingsCardHeader
                accent={ACCENTS.neutral}
                icon={Terminal}
                title="开发者工具"
                subtitle="打开 DevTools 查看日志与调试"
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-4">
                <p className="text-[13px] text-muted-foreground/80 leading-relaxed">
                  打开浏览器开发者工具，用于调试和查看控制台信息。
                </p>
                <Button
                  onClick={() => {
                    try {
                      if (window.electron && window.electron.openDevTools) {
                        window.electron.openDevTools();
                        toast({
                          title: "开发者工具已打开",
                          description: "控制台窗口已显示",
                        });
                      } else {
                        toast({
                          title: "打开失败",
                          description: "openDevTools 方法不可用，请重启应用",
                          variant: "destructive",
                        });
                      }
                    } catch (error) {
                      console.error("打开开发者工具失败:", error);
                      toast({
                        title: "打开失败",
                        description:
                          error instanceof Error ? error.message : "未知错误",
                        variant: "destructive",
                      });
                    }
                  }}
                  variant="outline"
                  className="w-full h-9 btn-hover">
                  <Terminal className="h-4 w-4 mr-1.5" />
                  打开开发者工具
                </Button>
              </CardContent>
            </SettingsCard>
            {/* 应用信息 */}
            {appInfo && (
              <SettingsCard accent={ACCENTS.neutral}>
                <SettingsCardHeader
                  accent={ACCENTS.neutral}
                  icon={Monitor}
                  title="应用信息"
                  subtitle="版本、数据目录与可执行文件路径"
                  status={
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 shrink-0">
                      <Sparkles className="h-3 w-3" />
                      v{appInfo.version}
                    </span>
                  }
                />
                <CardContent className="px-5 pb-5 pt-0">
                  <div className="space-y-2.5">
                    <PathRow
                      icon={FolderOpen}
                      label="数据目录"
                      value={appInfo.dataPath}
                      copied={copiedPath === appInfo.dataPath}
                      onCopy={() =>
                        handleCopyPath(appInfo.dataPath, "数据目录")
                      }
                      accent={ACCENTS.neutral}
                    />
                    <PathRow
                      icon={FileCog}
                      label="配置文件"
                      value={appInfo.configPath}
                      copied={copiedPath === appInfo.configPath}
                      onCopy={() =>
                        handleCopyPath(appInfo.configPath, "配置文件")
                      }
                      accent={ACCENTS.neutral}
                    />
                    {appInfo.appPath && (
                      <PathRow
                        icon={AppWindow}
                        label="应用路径"
                        value={appInfo.appPath}
                        copied={copiedPath === appInfo.appPath}
                        onCopy={() =>
                          handleCopyPath(appInfo.appPath, "应用路径")
                        }
                        accent={ACCENTS.neutral}
                      />
                    )}
                    {appInfo.exePath && (
                      <PathRow
                        icon={Binary}
                        label="可执行文件"
                        value={appInfo.exePath}
                        copied={copiedPath === appInfo.exePath}
                        onCopy={() =>
                          handleCopyPath(appInfo.exePath, "可执行文件")
                        }
                        accent={ACCENTS.neutral}
                      />
                    )}
                  </div>
                </CardContent>
              </SettingsCard>
            )}
              </div>
            )}

            {activeSection === "ui" && (
              <div className="grid grid-cols-1 gap-5 settings-grid">
            {/* 外观 — 浅色 / 深色 / 跟随系统 */}
            <SettingsCard accent={ACCENTS.accent}>
              <SettingsCardHeader
                accent={ACCENTS.accent}
                icon={Palette}
                title="外观"
                subtitle="应用配色主题"
                status={
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/25 shrink-0">
                    {theme === "light" ? <Sun className="h-3 w-3" /> : theme === "dark" ? <Moon className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                    {THEME_LABELS[theme]}
                  </span>
                }
              />
              <CardContent className="px-5 pb-5 pt-0">
                <p className="text-[12px] text-muted-foreground/80 leading-relaxed mb-3">
                  切换后立即生效并自动记住。选择"跟随系统"时，系统主题变化会同步应用。
                </p>
                <div
                  role="radiogroup"
                  aria-label="外观主题"
                  className="grid grid-cols-3 gap-2">
                  {THEME_OPTIONS.map((option) => {
                    const selected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setTheme(option.value)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-lg px-3 py-3 border transition-all duration-200 cursor-pointer",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                          selected
                            ? "bg-primary/[0.08] border-primary/45 shadow-[0_2px_8px_hsl(var(--primary)/0.14)]"
                            : "bg-card border-border hover:border-primary/25 hover:bg-primary/[0.04]"
                        )}>
                        <option.icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            selected ? "text-primary" : "text-muted-foreground"
                          )}
                        />
                        <span
                          className={cn(
                            "text-[12px] font-medium transition-colors",
                            selected ? "text-primary" : "text-foreground/80"
                          )}>
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </SettingsCard>

            {/* 侧边栏标签配置 — 用户自主选择哪些功能入口显示在侧栏 */}
            <SettingsCard accent={ACCENTS.accent}>
              <SettingsCardHeader
                accent={ACCENTS.accent}
                icon={Sliders}
                title="侧边栏标签"
                subtitle="选择需要在侧栏显示的功能入口"
                status={
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/25 shrink-0">
                    <ListChecks className="h-3 w-3" />
                    {Object.values(sidebarTabs).filter(Boolean).length + 1} / 6
                  </span>
                }
              />
              <CardContent className="px-5 pb-5 pt-0 space-y-2">
                <p className="text-[12px] text-muted-foreground/80 leading-relaxed mb-3">
                  主页始终可见，下面这些标签按需开启（浏览器默认开启）。
                </p>
                <SidebarTabToggle
                  icon={Home}
                  title="主页"
                  description="应用首页 — 剪贴板历史 + AI 助手"
                  enabled
                  locked
                  accent={ACCENTS.accent}
                />
                <SidebarTabToggle
                  icon={BookOpen}
                  title="笔记"
                  description="白板文件 + 笔记内容"
                  enabled={sidebarTabs.notes}
                  onToggle={() =>
                    setSidebarTabs({ ...sidebarTabs, notes: !sidebarTabs.notes })
                  }
                  accent={ACCENTS.accent}
                />
                <SidebarTabToggle
                  icon={ListChecks}
                  title="Todo"
                  description="任务管理 + 优先级 + 截止日期"
                  enabled={sidebarTabs.todos}
                  onToggle={() =>
                    setSidebarTabs({ ...sidebarTabs, todos: !sidebarTabs.todos })
                  }
                  accent={ACCENTS.accent}
                />
                <SidebarTabToggle
                  icon={PenTool}
                  title="力扣分类"
                  description="题单管理 + 题目标记"
                  enabled={sidebarTabs.leetcode}
                  onToggle={() =>
                    setSidebarTabs({
                      ...sidebarTabs,
                      leetcode: !sidebarTabs.leetcode,
                    })
                  }
                  accent={ACCENTS.accent}
                />
                <SidebarTabToggle
                  icon={Globe}
                  title="浏览器"
                  description="内嵌网页浏览 + 多标签页"
                  enabled={sidebarTabs.browser}
                  onToggle={() =>
                    setSidebarTabs({
                      ...sidebarTabs,
                      browser: !sidebarTabs.browser,
                    })
                  }
                  accent={ACCENTS.accent}
                />
                <SidebarTabToggle
                  icon={SettingsIcon}
                  title="设置"
                  description="服务配置 + 数据管理 + 检查更新"
                  enabled={sidebarTabs.settings}
                  onToggle={() =>
                    setSidebarTabs({
                      ...sidebarTabs,
                      settings: !sidebarTabs.settings,
                    })
                  }
                  accent={ACCENTS.accent}
                />
              </CardContent>
            </SettingsCard>
              </div>
            )}
          </div>
        </div>
      </div>

      <ClearVectorConfirmDialog
        open={clearVectorDialogOpen}
        onConfirm={handleClearVectorDialogConfirm}
        onCancel={() => setClearVectorDialogOpen(false)}
      />
      <ImportDatabaseConfirmDialog
        open={importDialogOpen}
        onConfirm={handleImportDialogConfirm}
        onCancel={() => setImportDialogOpen(false)}
      />
    </div>
  );
}

/**
 * Page-level status chip — 顶部展示当前各服务的整体配置情况
 */
function StatusChip({
  accent,
  label,
  configured,
}: {
  accent: AccentSpec;
  label: string;
  configured: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors",
        configured ? accent.badge : accent.badgeIdle
      )}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          configured ? accent.badgeDot : accent.badgeIdleDot
        )}
      />
      {label}
      <span className="opacity-60">·</span>
      <span className="opacity-80">{configured ? "就绪" : "未配置"}</span>
    </span>
  );
}

/**
 * PathRow — 应用信息内的路径行：图标 + 标签 + 路径 + 复制
 * 比原版更紧凑、视觉分组更清晰
 */
function PathRow({
  icon: Icon,
  label,
  value,
  copied,
  onCopy,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  accent: AccentSpec;
}) {
  return (
    <div className="group/path">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn("h-3 w-3", accent.iconText)} />
        <span className="text-[11px] font-medium text-muted-foreground/80">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "relative flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 cursor-pointer transition-all duration-150",
          "hover:bg-muted/70 hover:border-primary/30 hover:shadow-sm",
          copied && "border-emerald-500/40 bg-emerald-500/10"
        )}
        onClick={onCopy}
        title={`${value} (点击复制)`}>
        <p className="text-[11px] font-mono leading-snug text-foreground/85 flex-1 min-w-0 truncate">
          {value}
        </p>
        <span
          className={cn(
            "shrink-0 inline-flex items-center justify-center h-5 w-5 rounded transition-all duration-150",
            copied
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground/50 group-hover/path:text-primary/80"
          )}>
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * 侧边栏标签开关 — 每一行：图标 + 标题 + 简介 + Switch
 * - locked=true 表示固定项（主页），Switch 禁用并显示"固定"标识
 * - 用 shadcn/ui Switch 替代之前自绘的拨动开关，与其他 UI 控件统一
 */
function SidebarTabToggle({
  icon: Icon,
  title,
  description,
  enabled,
  locked,
  onToggle,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  enabled: boolean;
  locked?: boolean;
  onToggle?: (next: boolean) => void;
  accent: AccentSpec;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors duration-150",
        enabled
          ? "bg-muted/40 border-border/70"
          : "bg-muted/15 border-border/40",
        !locked && "hover:border-border"
      )}>
      <div
        className={cn(
          "h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
          enabled ? accent.iconBg + " " + accent.iconBorder : "bg-muted ring-1 ring-border"
        )}>
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            enabled ? accent.iconText : "text-muted-foreground/60"
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground/90">{title}</span>
          {locked && (
            <span className="text-[10px] text-muted-foreground/60 font-normal">
              固定
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/70 leading-tight truncate">
          {description}
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        disabled={locked}
        aria-label={`切换 ${title} 侧边栏标签`}
      />
    </div>
  );
}