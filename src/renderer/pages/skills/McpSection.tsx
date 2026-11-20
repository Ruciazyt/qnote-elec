import { useCallback, useEffect, useState } from "react";
import {
  Server,
  Plus,
  Loader2,
  Plug,
  Unplug,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  Wrench,
  FolderOpen,
  FolderX,
  RefreshCw,
  Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/ui/use-toast";
import {
  parseArgsLines,
  parseKeyValueLines,
  type McpProjectState,
  type McpServerInput,
  type McpServerState,
  type McpTransport,
} from "@shared/ai/mcp";

const TRANSPORTS: Array<{ id: McpTransport; label: string; hint: string }> = [
  { id: "stdio", label: "本地命令", hint: "启动本地进程，用 stdin/stdout 通信" },
  { id: "http", label: "HTTP", hint: "Streamable HTTP 端点" },
  { id: "sse", label: "SSE", hint: "旧版 SSE 端点" },
];

function StatusBadge({ status }: { status: McpServerState["status"] }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-success text-success-foreground shrink-0">
        已连接
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/30 shrink-0">
        连接失败
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground shrink-0">
        连接中
      </span>
    );
  }
  if (status === "disabled") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground shrink-0">
        已停用
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground shrink-0">
      未连接
    </span>
  );
}

export default function McpSection() {
  const { toast } = useToast();

  const [servers, setServers] = useState<McpServerState[]>([]);
  const [project, setProject] = useState<McpProjectState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerState | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTransport, setDraftTransport] = useState<McpTransport>("stdio");
  const [draftCommand, setDraftCommand] = useState("");
  const [draftArgs, setDraftArgs] = useState("");
  const [draftEnv, setDraftEnv] = useState("");
  const [draftCwd, setDraftCwd] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftHeaders, setDraftHeaders] = useState("");
  const [draftTimeout, setDraftTimeout] = useState("");

  const [deleting, setDeleting] = useState<McpServerState | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, projectState] = await Promise.all([
        window.electron.listMcpServers(),
        window.electron.getMcpProject(),
      ]);
      setServers(list || []);
      setProject(projectState);
    } catch (err) {
      console.error("加载 MCP 服务器失败", err);
      toast({ title: "加载失败", description: "无法读取 MCP 服务器列表", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setDraftName("");
    setDraftTransport("stdio");
    setDraftCommand("");
    setDraftArgs("");
    setDraftEnv("");
    setDraftCwd("");
    setDraftUrl("");
    setDraftHeaders("");
    setDraftTimeout("");
    setDialogOpen(true);
  };

  const openEdit = (server: McpServerState) => {
    setEditing(server);
    setDraftName(server.name);
    setDraftTransport(server.transport);
    setDraftCommand(server.command ?? "");
    setDraftArgs((server.args ?? []).join("\n"));
    setDraftEnv(
      Object.entries(server.env ?? {})
        .map(([k, v]) => k + "=" + v)
        .join("\n")
    );
    setDraftCwd(server.cwd ?? "");
    setDraftUrl(server.url ?? "");
    setDraftHeaders(
      Object.entries(server.headers ?? {})
        .map(([k, v]) => k + "=" + v)
        .join("\n")
    );
    setDraftTimeout(server.timeout ? String(server.timeout) : "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!draftName.trim()) {
      toast({ title: "请填写服务器名称", variant: "destructive" });
      return;
    }
    const timeout = draftTimeout.trim() ? Number(draftTimeout.trim()) : undefined;
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      toast({ title: "超时时间必须是正整数", variant: "destructive" });
      return;
    }
    const input: McpServerInput = {
      id: editing?.id,
      name: draftName.trim(),
      transport: draftTransport,
      enabled: true,
      command: draftCommand.trim(),
      args: parseArgsLines(draftArgs),
      env: parseKeyValueLines(draftEnv),
      cwd: draftCwd.trim(),
      url: draftUrl.trim(),
      headers: parseKeyValueLines(draftHeaders),
      timeout,
    };

    setSaving(true);
    try {
      const result = await window.electron.saveMcpServer(input);
      if (result.success) {
        toast({
          title: editing ? "服务器已更新" : "服务器已添加",
          description:
            result.server?.status === "connected"
              ? "已连接，提供 " + result.server.tools.length + " 个工具"
              : result.server?.error || "当前未连接",
        });
        setDialogOpen(false);
        await load();
      } else {
        toast({ title: result.error || "保存失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "保存失败", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async (server: McpServerState) => {
    setBusyId(server.id);
    try {
      const result = await window.electron.connectMcpServer(server.id);
      if (result.success) {
        toast({
          title: "「" + server.name + "」已连接",
          description: "提供 " + (result.server?.tools.length ?? 0) + " 个工具",
        });
      } else {
        toast({
          title: "「" + server.name + "」连接失败",
          description: result.error || "请检查配置",
          variant: "destructive",
        });
      }
      await load();
    } catch {
      toast({ title: "连接失败", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (server: McpServerState) => {
    setBusyId(server.id);
    try {
      await window.electron.disconnectMcpServer(server.id);
      await load();
    } catch {
      toast({ title: "断开失败", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (server: McpServerState) => {
    setBusyId(server.id);
    try {
      const result = await window.electron.setMcpServerEnabled(
        server.id,
        !server.enabled
      );
      if (!result.success) {
        toast({ title: result.error || "操作失败", variant: "destructive" });
      }
      await load();
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      const result = await window.electron.deleteMcpServer(deleting.id);
      if (result.success) {
        toast({ title: "已删除「" + deleting.name + "」" });
        setDeleting(null);
        await load();
      } else {
        toast({ title: result.error || "删除失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    } finally {
      setDeletingBusy(false);
    }
  };

  const handlePickProject = async () => {
    try {
      const result = await window.electron.pickMcpProjectDir();
      if (!result.success) {
        toast({ title: result.error || "选择目录失败", variant: "destructive" });
        return;
      }
      if (result.canceled) return;
      await load();
      toast({ title: "已切换项目配置目录" });
    } catch {
      toast({ title: "选择目录失败", variant: "destructive" });
    }
  };

  const handleClearProject = async () => {
    try {
      await window.electron.setMcpProjectDir(null);
      await load();
      toast({ title: "已移除项目配置目录" });
    } catch {
      toast({ title: "移除失败", variant: "destructive" });
    }
  };

  const handleReload = async () => {
    try {
      const result = await window.electron.reloadMcp();
      if (!result.success) {
        toast({ title: result.error || "重新加载失败", variant: "destructive" });
        return;
      }
      await load();
      toast({ title: "已重新加载" });
    } catch {
      toast({ title: "重新加载失败", variant: "destructive" });
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          MCP 服务器把外部能力接进 AI 对话。连上之后，它的工具会自动出现在助手的工具列表里。
        </p>
        <Button onClick={openCreate} className="h-9 btn-hover shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          添加服务器
        </Button>
      </div>

      <div className="mb-3 rounded-lg border border-border/70 bg-card px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-foreground">项目配置目录</p>
            <p className="text-[11px] text-muted-foreground mt-1 font-mono truncate">
              {project?.dir || "未设置"}
            </p>
            {project?.filePath && (
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono truncate">
                {project.filePath}
              </p>
            )}
            {project?.error && (
              <p className="text-[11px] text-destructive mt-1 break-words">
                {project.error}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              该目录下的 .mcp.json 会被读取，与上面的配置合并，同名以项目配置为准。
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              onClick={() => void handlePickProject()}
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-muted"
              aria-label="选择项目目录"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
            <Button
              onClick={() => void handleClearProject()}
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-muted"
              aria-label="清除项目目录"
              disabled={!project?.dir}
            >
              <FolderX className="h-3.5 w-3.5" />
            </Button>
            <Button
              onClick={() => void handleReload()}
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-muted"
              aria-label="重新加载"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : servers.length === 0 ? (
        <div className="max-w-2xl rounded-xl border border-dashed border-border/70 py-16 text-center">
          <div className="h-12 w-12 rounded-xl bg-muted/60 flex items-center justify-center mx-auto mb-3">
            <Server className="h-5 w-5 text-muted-foreground/50" />
          </div>
          <p className="text-sm text-muted-foreground/80">还没有 MCP 服务器</p>
          <p className="text-[11px] text-muted-foreground/55 mt-1">
            点击「添加服务器」接入本地命令或 HTTP 端点
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => {
            const expanded = expandedId === server.id;
            const busy = busyId === server.id;
            const readOnly = server.source === "project";
            const target =
              server.transport === "stdio"
                ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
                : server.url;
            return (
              <div
                key={server.id}
                className="group rounded-lg border border-border/70 bg-card px-4 py-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Server className="h-3.5 w-3.5 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {server.name}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground shrink-0">
                        {server.transport}
                      </span>
                      <span
                        className={
                          readOnly
                            ? "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary text-primary-foreground shrink-0"
                            : "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/60 text-muted-foreground shrink-0"
                        }
                      >
                        {readOnly ? "项目" : "手动"}
                      </span>
                      <StatusBadge status={server.status} />
                    </div>

                    {target && (
                      <p className="text-[12px] text-muted-foreground mt-1 font-mono truncate">
                        {target}
                      </p>
                    )}

                    {server.status === "connected" && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        提供 {server.tools.length} 个工具
                      </p>
                    )}

                    {server.timeout && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        超时 {server.timeout} 毫秒
                      </p>
                    )}

                    {server.error && (
                      <p className="text-[11px] text-destructive mt-1 break-words">
                        {server.error}
                      </p>
                    )}

                    {expanded && server.tools.length > 0 && (
                      <div className="mt-2 rounded-md border border-border/60 overflow-hidden">
                        {server.tools.map((t) => (
                          <div
                            key={t.name}
                            className="px-3 py-2 border-b border-border/40 last:border-b-0"
                          >
                            <div className="flex items-center gap-1.5">
                              <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="text-[11px] font-medium text-foreground font-mono">
                                {t.name}
                              </span>
                            </div>
                            {t.description && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                                {t.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {!readOnly && (
                      <Button
                        onClick={() => void handleToggle(server)}
                        disabled={busy}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-muted"
                        aria-label={server.enabled ? "停用" : "启用"}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    {server.status === "connected" ? (
                      <Button
                        onClick={() => void handleDisconnect(server)}
                        disabled={busy}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-muted"
                        aria-label="断开连接"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Unplug className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => void handleConnect(server)}
                        disabled={busy || !server.enabled}
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-muted"
                        aria-label="连接"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plug className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}

                    {!readOnly && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <Button
                          onClick={() => openEdit(server)}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-muted"
                          aria-label="编辑服务器"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          onClick={() => setDeleting(server)}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                          aria-label="删除服务器"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {server.tools.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : server.id)}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {expanded ? "收起工具列表" : "查看工具列表（" + server.tools.length + "）"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">
                {editing ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
              </h2>
              <Button
                onClick={() => setDialogOpen(false)}
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="mcp-server-name" className="text-xs font-medium text-foreground/80">
                  名称
                </label>
                <Input
                  id="mcp-server-name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="如：Jira 工单"
                  maxLength={40}
                  className="h-9 bg-muted/30 focus-visible:bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground/80">连接方式</span>
                <div className="flex gap-2">
                  {TRANSPORTS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDraftTransport(t.id)}
                      title={t.hint}
                      className={
                        draftTransport === t.id
                          ? "flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground"
                          : "flex-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted"
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {TRANSPORTS.find((t) => t.id === draftTransport)?.hint}
                </p>
              </div>

              {draftTransport === "stdio" ? (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="mcp-command" className="text-xs font-medium text-foreground/80">
                      启动命令
                    </label>
                    <Input
                      id="mcp-command"
                      value={draftCommand}
                      onChange={(e) => setDraftCommand(e.target.value)}
                      placeholder="npx"
                      className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="mcp-args" className="text-xs font-medium text-foreground/80">
                      参数（每行一个）
                    </label>
                    <textarea
                      id="mcp-args"
                      value={draftArgs}
                      onChange={(e) => setDraftArgs(e.target.value)}
                      placeholder={"-y\n@modelcontextprotocol/server-filesystem\nD:/workspace"}
                      rows={4}
                      className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 outline-none resize-y font-mono text-[12px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="mcp-env" className="text-xs font-medium text-foreground/80">
                      环境变量（每行 KEY=VALUE）
                    </label>
                    <textarea
                      id="mcp-env"
                      value={draftEnv}
                      onChange={(e) => setDraftEnv(e.target.value)}
                      placeholder={"API_KEY=xxx"}
                      rows={3}
                      className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 outline-none resize-y font-mono text-[12px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="mcp-cwd" className="text-xs font-medium text-foreground/80">
                      工作目录（可选）
                    </label>
                    <Input
                      id="mcp-cwd"
                      value={draftCwd}
                      onChange={(e) => setDraftCwd(e.target.value)}
                      placeholder="D:/workspace"
                      className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="mcp-url" className="text-xs font-medium text-foreground/80">
                      服务器地址
                    </label>
                    <Input
                      id="mcp-url"
                      value={draftUrl}
                      onChange={(e) => setDraftUrl(e.target.value)}
                      placeholder="http://127.0.0.1:3000/mcp"
                      className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="mcp-headers" className="text-xs font-medium text-foreground/80">
                      请求头（每行 KEY=VALUE，可选）
                    </label>
                    <textarea
                      id="mcp-headers"
                      value={draftHeaders}
                      onChange={(e) => setDraftHeaders(e.target.value)}
                      placeholder={"Authorization=Bearer xxx"}
                      rows={3}
                      className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 outline-none resize-y font-mono text-[12px]"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <label htmlFor="mcp-timeout" className="text-xs font-medium text-foreground/80">
                  超时（毫秒，可选）
                </label>
                <Input
                  id="mcp-timeout"
                  value={draftTimeout}
                  onChange={(e) => setDraftTimeout(e.target.value)}
                  placeholder="留空则连接 15000、调用 60000"
                  inputMode="numeric"
                  className="h-9 bg-muted/30 focus-visible:bg-background font-mono text-[12px]"
                />
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                命令、参数、环境变量、地址与请求头里可以写 {"${变量名}"} 或 {"${变量名:-默认值}"}，连接时从系统环境变量取值。
              </p>
            </div>

            <div className="flex gap-2 mt-5">
              <Button
                onClick={() => setDialogOpen(false)}
                variant="outline"
                className="flex-1 h-9"
              >
                取消
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1 h-9">
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1.5" />
                )}
                保存并连接
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl">
            <h2 className="text-sm font-semibold text-foreground">删除 MCP 服务器</h2>
            <p className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
              确定要删除「{deleting.name}」吗？它的连接和工具会一并移除，配置不可恢复。
            </p>
            <div className="flex gap-2 mt-5">
              <Button
                onClick={() => setDeleting(null)}
                variant="outline"
                className="flex-1 h-9"
              >
                取消
              </Button>
              <Button
                onClick={handleDelete}
                disabled={deletingBusy}
                className="flex-1 h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletingBusy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1.5" />
                )}
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
