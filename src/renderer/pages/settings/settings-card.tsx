import * as React from "react";
import { Card } from "../../components/ui/card";
import { cn } from "@/lib/utils";


export type AccentKey = "accent" | "neutral";

export interface AccentSpec {
  iconText: string;
  iconBg: string;
  iconBorder: string;
  badge: string;
  badgeDot: string;
  badgeIdle: string;
  badgeIdleDot: string;
  sectionIcon: string;
  hoverBorder: string;
}

export const ACCENTS: Record<AccentKey, AccentSpec> = {
  accent: {
    iconText: "text-primary",
    iconBg: "bg-primary/10",
    iconBorder: "ring-1 ring-primary/20",
    badge: "bg-primary/10 text-primary-strong border-primary/25",
    badgeDot: "bg-primary",
    badgeIdle: "bg-muted text-muted-foreground/70 border-border/70",
    badgeIdleDot: "bg-muted-foreground/40",
    sectionIcon: "text-primary",
    hoverBorder: "hover:border-primary/40 focus-within:border-primary/40",
  },
  neutral: {
    iconText: "text-muted-foreground",
    iconBg: "bg-muted",
    iconBorder: "ring-1 ring-border",
    badge: "bg-muted text-muted-foreground border-border",
    badgeDot: "bg-muted-foreground",
    badgeIdle: "bg-muted/60 text-muted-foreground border-border/60",
    badgeIdleDot: "bg-muted-foreground/30",
    sectionIcon: "text-muted-foreground",
    hoverBorder: "hover:border-muted-foreground/30 focus-within:border-muted-foreground/30",
  },
};

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
