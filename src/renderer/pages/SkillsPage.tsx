import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Plus,
  Search,
  Trash2,
  Pencil,
  Download,
  Loader2,
  Check,
  X,
  AlertCircle,
  SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Skill {
  id: string;
  name: string;
  content: string;
  isCustom: boolean;
}

/** 内置示例 — 与设置页一致 */
const SKILL_EXAMPLES: Array<{ name: string; content: string; hint: string }> = [
  {
    name: "翻译成英文",
    content: "把以下内容翻译成英文，保持原意，只输出译文：\n\n{content}",
    hint: "用 {content} 占位你的输入",
  },
  {
    name: "润色中文",
    content:
      "你是一个中文写作助手。把用户输入润色成更流畅专业的表达，保持原意和长度，不要添加新内容。",
    hint: "不含占位符 → 作为系统指令持续生效",
  },
  {
    name: "总结剪贴板",
    content: "用三句话总结以下内容的核心观点：\n\n{clipboard}",
    hint: "用 {clipboard} 占位剪贴板内容",
  },
  {
    name: "提取待办",
    content: "从以下内容中提取出待办事项，每行一条，不要编号：\n\n{clipboard}",
    hint: "把剪贴板内容里的事项提成待办",
  },
  {
    name: "解释代码",
    content:
      "用通俗易懂的语言解释下面这段代码在做什么，逐段说明。保持简洁，不要写代码。\n\n{clipboard}",
    hint: "解释剪贴板里的代码",
  },
];

export default function SkillsPage() {
  const { toast } = useToast();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // 编辑弹窗
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);

  // 导入弹窗
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{
    skills: Array<{ name: string; content: string }>;
    rejected: Array<{ name: string; reason: string }>;
    error?: string;
  } | null>(null);
  const [importing2, setImporting2] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await window.electron.getAiSkills();
      setSkills(
        (list || []).map((s) => ({
          id: s.id,
          name: s.name,
          content: s.content,
          isCustom: s.isCustom,
        }))
      );
    } catch (err) {
      console.error("加载技能失败", err);
      toast({ title: "加载失败", description: "无法读取技能列表", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // load 内部已 try/catch，失败会 toast，这里不等待结果
    void load();
  }, [load]);

  // 搜索过滤（按名称或内容）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
    );
  }, [skills, query]);

  // ---- 编辑 ----

  const openCreate = () => {
    setEditingId(null);
    setDraftName("");
    setDraftContent("");
    setEditOpen(true);
  };

  const openEdit = (skill: Skill) => {
    setEditingId(skill.id);
    setDraftName(skill.name);
    setDraftContent(skill.content);
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!draftName.trim() || !draftContent.trim()) {
      toast({ title: "技能名和内容都不能为空", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await window.electron.saveAiSkill({
        id: editingId ?? undefined,
        name: draftName.trim(),
        content: draftContent.trim(),
      });
      if (result.success) {
        toast({ title: editingId ? "技能已更新" : "技能已创建" });
        setEditOpen(false);
        setEditingId(null);
        setDraftName("");
        setDraftContent("");
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

  const handleDelete = async (skill: Skill) => {
    setDeletingId(skill.id);
    try {
      const result = await window.electron.deleteAiSkill(skill.id);
      if (result.success) {
        toast({ title: `已删除「${skill.name}」` });
        await load();
      } else {
        toast({ title: "删除失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "删除失败", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  // ---- 导入 ----

  const handlePreview = async () => {
    if (!importUrl.trim()) {
      toast({ title: "请输入 URL", variant: "destructive" });
      return;
    }
    setImporting(true);
    setPreview(null);
    try {
      const result = await window.electron.previewAiSkillUrl(importUrl.trim());
      if (result.success) {
        setPreview({ skills: result.skills, rejected: result.rejected });
        toast({
          title: `解析到 ${result.skills.length} 个技能`,
          description:
            result.rejected.length > 0 ? `${result.rejected.length} 个被跳过` : undefined,
        });
      } else {
        setPreview({ skills: [], rejected: result.rejected || [], error: result.error });
        toast({ title: result.error || "拉取失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "拉取失败", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview || preview.skills.length === 0) return;
    setImporting2(true);
    try {
      const result = await window.electron.importAiSkills(preview.skills);
      if (result.success) {
        const imported = result.imported?.length ?? 0;
        const updated = result.updated?.length ?? 0;
        toast({
          title: `导入完成：新增 ${imported}，更新 ${updated}`,
        });
        setImportOpen(false);
        setImportUrl("");
        setPreview(null);
        await load();
      } else {
        toast({ title: result.error || "导入失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "导入失败", variant: "destructive" });
    } finally {
      setImporting2(false);
    }
  };

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <div className="max-w-5xl mx-auto w-full">
        {/* Page Hero */}
        <div className="mb-6 sm:mb-8 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">AI 技能</h1>
              <p className="text-[13px] text-muted-foreground/75 mt-1">
                自定义提示词技能，在 AI 对话时一键套用
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={() => {
                setImportOpen(true);
                setPreview(null);
                setImportUrl("");
              }}
              variant="outline"
              className="h-9 btn-hover"
            >
              <Download className="h-4 w-4 mr-1.5" />
              从 URL 导入
            </Button>
            <Button onClick={openCreate} className="h-9 btn-hover">
              <Plus className="h-4 w-4 mr-1.5" />
              新建技能
            </Button>
          </div>
        </div>

        {/* 搜索 */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能的名称或内容…"
            className="h-10 pl-9 bg-card"
          />
        </div>

        {/* 技能列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground/60">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 py-16 text-center">
            <div className="h-12 w-12 rounded-xl bg-muted/60 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground/80">
              {query ? "没有匹配的技能" : "还没有技能"}
            </p>
            <p className="text-[11px] text-muted-foreground/55 mt-1">
              {query ? "换个关键词试试" : "点击「新建技能」创建第一个，或从 URL 导入"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((skill) => (
              <div
                key={skill.id}
                className="group rounded-lg border border-border/70 bg-card px-4 py-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {skill.name}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-muted/60 text-muted-foreground/70 border-border shrink-0">
                        自定义
                      </span>
                    </div>
                    <p className="text-[12px] text-muted-foreground/70 mt-1 leading-relaxed line-clamp-2">
                      {skill.content}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      onClick={() => openEdit(skill)}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-muted"
                      aria-label="编辑技能"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      onClick={() => handleDelete(skill)}
                      disabled={deletingId === skill.id}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                      aria-label="删除技能"
                    >
                      {deletingId === skill.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============ 编辑弹窗 ============ */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">
                {editingId ? "编辑技能" : "新建技能"}
              </h2>
              <Button
                onClick={() => setEditOpen(false)}
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
                <label className="text-xs font-medium text-foreground/80">技能名</label>
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="如：翻译成英文"
                  maxLength={30}
                  className="h-9 bg-muted/30 focus-visible:bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground/80">技能内容</label>
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder={
                    "不含占位符 → 作为系统指令，多轮持续生效\n含 {content} → 替换成你的输入\n含 {clipboard} → 替换成剪贴板内容"
                  }
                  rows={8}
                  maxLength={4000}
                  className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/30 outline-none resize-y font-mono text-[12px]"
                />
                <p className="text-[10px] text-muted-foreground/60">
                  {draftContent.length} / 4000
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground/70">插入示例</label>
                <div className="flex flex-wrap gap-1.5">
                  {SKILL_EXAMPLES.map((ex) => (
                    <button
                      key={ex.name}
                      type="button"
                      onClick={() => {
                        setDraftName(ex.name);
                        setDraftContent(ex.content);
                      }}
                      title={ex.hint}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] border bg-muted/60 text-muted-foreground/80 border-border hover:bg-muted transition-colors"
                    >
                      {ex.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <Button
                onClick={() => setEditOpen(false)}
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
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============ 导入弹窗 ============ */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">从 URL 导入技能</h2>
              <Button
                onClick={() => setImportOpen(false)}
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
                <label className="text-xs font-medium text-foreground/80">技能 URL</label>
                <div className="flex gap-2">
                  <Input
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        // 回车拉取预览，内部已处理失败分支，这里不等待结果
                        void handlePreview();
                      }
                    }}
                    placeholder="https://raw.githubusercontent.com/..."
                    className="h-9 bg-muted/30 focus-visible:bg-background"
                  />
                  <Button
                    onClick={handlePreview}
                    disabled={importing}
                    className="h-9 shrink-0"
                  >
                    {importing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-1.5" />
                    )}
                    拉取
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                  支持 JSON（单个对象 / 数组 / {"{ skills: [...] }"} 包装）或纯文本。
                  GitHub 的 blob 链接会自动转成 raw。
                </p>
              </div>

              {preview && (
                <div className="space-y-2">
                  {preview.error && (
                    <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/25 px-3 py-2">
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <span className="text-[11px] text-destructive leading-relaxed">
                        {preview.error}
                      </span>
                    </div>
                  )}

                  {preview.skills.length > 0 && (
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <div className="px-3 py-2 bg-muted/40 text-[11px] font-medium text-foreground/80 border-b border-border/60">
                        解析到 {preview.skills.length} 个技能
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y divide-border/40">
                        {preview.skills.map((s, i) => (
                          <div key={i} className="px-3 py-2">
                            <div className="text-[11px] font-medium text-foreground/85">
                              {s.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground/60 line-clamp-2 mt-0.5">
                              {s.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preview.rejected.length > 0 && (
                    <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2">
                      <div className="text-[11px] text-amber-700 dark:text-amber-300 font-medium mb-1">
                        {preview.rejected.length} 个被跳过
                      </div>
                      {preview.rejected.slice(0, 5).map((r, i) => (
                        <div
                          key={i}
                          className="text-[10px] text-amber-700/80 dark:text-amber-300/80"
                        >
                          {r.name} — {r.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <Button
                onClick={() => setImportOpen(false)}
                variant="outline"
                className="flex-1 h-9"
              >
                取消
              </Button>
              <Button
                onClick={handleConfirmImport}
                disabled={!preview || preview.skills.length === 0 || importing2}
                className="flex-1 h-9"
              >
                {importing2 ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1.5" />
                )}
                导入 {preview?.skills.length ?? 0} 个
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
