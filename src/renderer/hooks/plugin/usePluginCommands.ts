import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/ui/use-toast";
import type { PluginCommandEntry } from "@shared/plugin/manifest/pluginTypes";

export interface PluginCommandsApi {
  commands: PluginCommandEntry[];
  running: boolean;
  reload: () => Promise<void>;
  run: (command: string) => Promise<void>;
}

export function usePluginCommands(): PluginCommandsApi {
  const { toast } = useToast();
  const [commands, setCommands] = useState<PluginCommandEntry[]>([]);
  const [running, setRunning] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await window.electron.pluginListCommands();
      setCommands(list);
    } catch (err) {
      console.error("读取插件命令失败", err);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (command: string) => {
      if (!command || running) return;
      setRunning(true);
      try {
        const res = await window.electron.pluginExecuteCommand(command);
        if (res.needsConfirmation) {
          const opened = await window.electron.dialogOpen({
            type: "start-confirm",
            payload: res.needsConfirmation as unknown as Record<string, unknown>,
          });
          if (!opened?.ok) {
            toast({
              title: "启动失败",
              description: opened?.error ?? "打不开确认窗口",
              variant: "destructive",
            });
            return;
          }
          toast({
            title: "请先确认运行这个插件",
            description: "确认之后再执行一次这个命令",
          });
          return;
        }
        if (!res.ok) {
          toast({
            title: "命令执行失败",
            description: res.error,
            variant: "destructive",
          });
          return;
        }
        await reload();
      } catch (err) {
        toast({
          title: "命令执行失败",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setRunning(false);
      }
    },
    [reload, running, toast]
  );

  return { commands, running, reload, run };
}
