import { useCallback, useState } from "react";
import { useToast } from "@/hooks/ui/use-toast";
import type {
  GitlabBotConfigView,
  GitlabBotStatus,
  GitlabRunnerStatusView,
} from "@shared/ai/gitlabBot";

export interface GitlabBotDraft {
  enabled: boolean;
  triggerWords: string;
  allowedProjects: string;
  runnerEnabled: boolean;
  runnerProject: string;
}

const EMPTY_DRAFT: GitlabBotDraft = {
  enabled: false,
  triggerWords: "@qnote",
  allowedProjects: "",
  runnerEnabled: true,
  runnerProject: "",
};

function splitList(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function useGitlabBotConfig() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GitlabBotDraft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<GitlabBotStatus | null>(null);
  const [runner, setRunner] = useState<GitlabRunnerStatusView | null>(null);
  const [saving, setSaving] = useState(false);

  const update = useCallback((patch: Partial<GitlabBotDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const readConfig = useCallback(async (): Promise<GitlabBotConfigView | null> => {
    try {
      const result = await window.electron.getGitlabBotConfig();
      const config: GitlabBotConfigView = result.config;
      setDraft({
        enabled: config.enabled,
        triggerWords: config.triggerWords.join(", "),
        allowedProjects: config.allowedProjects.join(", "),
        runnerEnabled: config.runnerEnabled,
        runnerProject: config.runnerProject,
      });
      setStatus(result.status);
      setRunner(result.runner ?? null);
      return config;
    } catch {
      toast({
        title: "读取配置失败",
        description: "无法获取 GitLab 网关配置",
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  const openDialog = useCallback(async () => {
    const config = await readConfig();
    if (config) setOpen(true);
  }, [readConfig]);

  const restartRunner = useCallback(async () => {
    try {
      const result = await window.electron.restartGitlabBotRunner();
      if (!result.success) {
        toast({ title: result.error || "重启 Runner 失败", variant: "destructive" });
        return;
      }
      setRunner(result.runner ?? null);
      toast({ title: "Runner 已重启" });
    } catch {
      toast({ title: "重启 Runner 失败", variant: "destructive" });
    }
  }, [toast]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const result = await window.electron.saveGitlabBotConfig({
        enabled: draft.enabled,
        triggerWords: splitList(draft.triggerWords),
        allowedProjects: splitList(draft.allowedProjects),
        runnerEnabled: draft.runnerEnabled,
        runnerProject: draft.runnerProject.trim(),
      });
      if (!result.success) {
        toast({ title: result.error || "保存失败", variant: "destructive" });
        return;
      }
      setStatus(result.status ?? null);
      toast({ title: "GitLab 网关配置已保存" });
      setOpen(false);
      await readConfig();
    } catch {
      toast({ title: "保存失败", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [draft, readConfig, toast]);

  return {
    open,
    setOpen,
    draft,
    update,
    status,
    runner,
    saving,
    openDialog,
    restartRunner,
    save,
  };
}
