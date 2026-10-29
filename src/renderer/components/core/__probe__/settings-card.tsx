import * as React from "react";
import { Card } from "../ui/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 设置页卡片的共享外观原语
//
// 单独成文件而不是留在 settings.tsx 里，是因为「应用更新」卡片要复用同一套
// 卡片外观。如果让 UpdateCard.tsx 从 settings.tsx 反向 import，就会形成
// 循环依赖（settings.tsx → UpdateCard.tsx → settings.tsx）—— 组件在模块求值
// 期间就可能被引用到，行为随打包器实现而变，很难排查。
//
// 原语只依赖 ui/card 与 lib/utils，不含任何业务逻辑，抽取无副作用。
// ---------------------------------------------------------------------------

// 主题色系统（降噪版） —— 之前 6 套强调色让设置页像万花筒，
// 现在收敛到 2 套：accent（强调配置卡）+ neutral（中性 / 工具卡）
// Tailwind JIT 不支持动态字符串拼接 class，所以这里做静态映射
export type AccentKey = "accent" | "neutral";

export interface AccentSpec {
  iconText: string;
  /** 图标背景 — 平面 tint，去掉了 from-X to-Y 多重渐变（AI 调色板的标志） */
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
      )}
    >
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
            )}
          >
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
