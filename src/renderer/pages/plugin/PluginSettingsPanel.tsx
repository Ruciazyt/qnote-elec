import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/ui/use-toast";
import { cn } from "@/lib/utils";
import type {
  PluginRecord,
  PluginSettingValue,
} from "@shared/plugin/pluginTypes";

interface PluginSettingsPanelProps {
  plugin: PluginRecord;
  className?: string;
}

function coerce(
  type: string,
  value: string | number | boolean | null | undefined
): string | number | boolean {
  const text =
    value === null || value === undefined
      ? null
      : typeof value === "boolean"
        ? value
          ? "true"
          : "false"
        : String(value);
  if (text === null) {
    return type === "boolean" ? false : type === "number" ? 0 : "";
  }
  if (type === "number") {
    const num = Number(text);
    return Number.isFinite(num) ? num : 0;
  }
  if (type === "boolean") return text === "true";
  return text;
}

export function PluginSettingsPanel({
  plugin,
  className,
}: PluginSettingsPanelProps) {
  const { toast } = useToast();
  const declared = useMemo(
    () => plugin.contributes?.settings ?? [],
    [plugin.contributes]
  );
  const [values, setValues] = useState<Record<string, string | number | boolean>>(
    {}
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (declared.length === 0) return;
    try {
      const rows: PluginSettingValue[] = await window.electron.pluginGetSettings(
        plugin.id
      );
      const next: Record<string, string | number | boolean> = {};
      for (const item of declared) {
        const stored = rows.find((row) => row.key === item.key);
        next[item.key] = coerce(item.type, stored?.value ?? item.default);
      }
      setValues(next);
    } catch (err) {
      console.error("读取插件设置失败", err);
    }
  }, [declared, plugin.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (key: string) => {
    setSavingKey(key);
    try {
      const res = await window.electron.pluginSetSetting(
        plugin.id,
        key,
        values[key] ?? null
      );
      if (!res.ok) {
        toast({
          title: "保存失败",
          description: res.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "已保存", description: `${plugin.name} 的设置项 ${key}` });
      await load();
    } catch (err) {
      toast({
        title: "保存失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  if (declared.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-border/60 bg-muted/30 px-3 py-2.5",
          className
        )}>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          这个插件没有声明设置项。
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {declared.map((item) => {
        const value = values[item.key];
        return (
          <div key={item.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`ps-${item.key}`} className="text-[12px]">
                {item.title ?? item.key}
              </Label>
              <span className="text-[11px] font-mono text-muted-foreground">
                {item.key}
              </span>
            </div>
            {item.description && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {item.description}
              </p>
            )}
            <div className="flex items-center gap-2">
              {item.type === "boolean" ? (
                <input
                  id={`ps-${item.key}`}
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [item.key]: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                />
              ) : (
                <Input
                  id={`ps-${item.key}`}
                  type={item.type === "number" ? "number" : "text"}
                  value={
                    typeof value === "boolean" ? "" : (value ?? "")
                  }
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [item.key]:
                        item.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    }))
                  }
                  className="h-8 text-xs"
                />
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs btn-hover flex-shrink-0"
                disabled={savingKey === item.key}
                onClick={() => void save(item.key)}>
                {savingKey === item.key ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        插件通过 SDK 的 <code className="font-mono">ctx.settings.get</code>{" "}
        读到的就是这个值。
      </p>
    </div>
  );
}
