import { useCallback, useState } from "react";
import { useToast } from "@/hooks/ui/use-toast";
import type {
  GitlabBotConfigView,
  GitlabBotStatus,
  GitlabRunnerStatusView,
} from "@shared/ai/gitlabBot";

export interface GitlabBotDraft {
  enabled: boolean;
  port: string;
  bindAddress: string;
  signingToken: string;
  relayToken: string;
  triggerWords: string;
  allowedProjects: string;
  signingTokenHint: string;
  secretTokenHint: string;
  relayTokenHint: string;
  runnerEnabled: boolean;
  runnerProject: string;
  runnerTags: string;
}

const EMPTY_DRAFT: GitlabBotDraft = {
  enabled: false,
  port: "7799",
  bindAddress: "0.0.0.0",
  signingToken: "",
  relayToken: "",
  triggerWords: "@qnote",
  allowedProjects: "",
  signingTokenHint: "",
  secretTokenHint: "",
  relayTokenHint: "",
  runnerEnabled: true,
  runnerProject: "",
  runnerTags: "qnote",
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
        port: String(config.port),
        bindAddress: config.bindAddress,
        signingToken: "",
        relayToken: "",
        triggerWords: config.triggerWords.join(", "),
        allowedProjects: config.allowedProjects.join(", "),
        signingTokenHint: config.signingTokenHint,
        secretTokenHint: config.secretTokenHint,
        relayTokenHint: config.relayTokenHint,
        runnerEnabled: config.runnerEnabled,
        runnerProject: config.runnerProject,
        runnerTags: config.runnerTags.join(", "),
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

  const generateSecret = useCallback(async () => {
    try {
      const result = await window.electron.generateGitlabBotSecret();
      if (!result.success || !result.secret) {
        toast({ title: result.error || "生成失败", variant: "destructive" });
        return;
      }
      update({ signingToken: result.secret });
      toast({ title: "已生成签名密钥，保存后生效" });
    } catch {
      toast({ title: "生成失败", variant: "destructive" });
    }
  }, [toast, update]);

  const generateRelayToken = useCallback(async () => {
    try {
      const result = await window.electron.generateGitlabBotRelayToken();
      if (!result.success || !result.token) {
        toast({ title: result.error || "生成失败", variant: "destructive" });
        return;
      }
      update({ relayToken: result.token });
      toast({ title: "已生成 relay 令牌，保存后生效" });
    } catch {
      toast({ title: "生成失败", variant: "destructive" });
    }
  }, [toast, update]);

  const copyRelayToken = useCallback(async () => {
    try {
      const result = await window.electron.revealGitlabBotRelayToken();
      if (!result.success || !result.token) {
        toast({ title: "还没有 relay 令牌", description: "先生成一个再复制", variant: "destructive" });
        return;
      }
      await navigator.clipboard.writeText(result.token);
      toast({ title: "relay 令牌已复制" });
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  }, [toast]);

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
        port: Number(draft.port) || 7799,
        bindAddress: draft.bindAddress.trim() || "0.0.0.0",
        signingToken: draft.signingToken.trim() || undefined,
        relayToken: draft.relayToken.trim() || undefined,
        triggerWords: splitList(draft.triggerWords),
        allowedProjects: splitList(draft.allowedProjects),
        runnerEnabled: draft.runnerEnabled,
        runnerProject: draft.runnerProject.trim(),
        runnerTags: splitList(draft.runnerTags),
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
    generateSecret,
    generateRelayToken,
    copyRelayToken,
    restartRunner,
    save,
  };
}
