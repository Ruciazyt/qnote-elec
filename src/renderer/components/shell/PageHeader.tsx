import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-start gap-4", className)}>
      <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight leading-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="ml-auto flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
