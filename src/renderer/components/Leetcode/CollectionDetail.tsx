import { useState, useEffect, useCallback } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Card, CardContent } from "../ui/card";
import { Check, Plus, Trash2, ExternalLink, Edit2, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Problem {
  id?: number;
  link: string;
  is_completed: boolean;
  title?: string; // 题目标题（可选，用于缓存）
  difficulty?: string; // 题目难易度：Easy/Medium/Hard
}

interface Collection {
  id?: number;
  name: string;
  summary: string;
  problems?: Problem[];
}

interface CollectionDetailProps {
  collectionId: number;
  onRefresh: () => void;
}


// Window.electron type is declared in src/electron.d.ts
// 从 LeetCode URL 中提取 slug
function extractProblemSlug(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\/problems\/([^/]+)\/?/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// 从 slug 生成标题（备用方案）
function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// 从 LeetCode URL 中提取题目标题
function extractProblemTitle(url: string, cachedTitle?: string): string {
  // 如果有缓存的标题，直接使用
  if (cachedTitle) {
    return cachedTitle;
  }

  // 否则从 URL 解析
  const slug = extractProblemSlug(url);
  if (slug) {
    return slugToTitle(slug);
  }

  // 如果无法解析，返回 URL 的域名部分或完整 URL（截断）
  try {
    const urlObj = new URL(url);
    return urlObj.hostname || url.substring(0, 50);
  } catch {
    return url.length > 50 ? url.substring(0, 50) + "..." : url;
  }
}

export default function CollectionDetail({ collectionId, onRefresh }: CollectionDetailProps) {
  const [collection, setCollection] = useState<Collection>({
    name: "",
    summary: "",
    problems: [],
  });
  const [editingName, setEditingName] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tempSummary, setTempSummary] = useState("");
  const [newProblemLink, setNewProblemLink] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadCollection = useCallback(async () => {
    try {
      const data = await window.electron.getLeetcodeCollection(collectionId);
      if (data) {
        setCollection({
          id: data.id,
          name: data.name,
          summary: data.summary || "",
          problems: data.problems || [],
        });
      }
    } catch {
      toast({
        title: "加载失败",
        description: "无法加载题单数据",
        variant: "destructive",
      });
    }
  }, [collectionId, toast]);

  useEffect(() => {
    loadCollection();
  }, [loadCollection]);

  const handleStartEditName = () => {
    setTempName(collection.name);
    setEditingName(true);
  };

  const handleSaveName = async () => {
    if (!tempName.trim()) {
      toast({
        title: "保存失败",
        description: "题单名称不能为空",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const saved = await window.electron.saveLeetcodeCollection({
        id: collection.id,
        name: tempName.trim(),
        summary: collection.summary,
        problems: collection.problems,
      });

      if (saved) {
        setCollection({ ...collection, name: saved.name });
        setEditingName(false);
        onRefresh();
        toast({
          title: "保存成功",
          description: "题单名称已更新",
        });
      }
    } catch {
      toast({
        title: "保存失败",
        description: "保存题单名称时出错",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setTempName("");
  };

  const handleStartEditSummary = () => {
    setTempSummary(collection.summary);
    setEditingSummary(true);
  };

  const handleSaveSummary = async () => {
    setSaving(true);
    try {
      const saved = await window.electron.saveLeetcodeCollection({
        id: collection.id,
        name: collection.name,
        summary: tempSummary.trim(),
        problems: collection.problems,
      });

      if (saved) {
        setCollection({ ...collection, summary: saved.summary });
        setEditingSummary(false);
        onRefresh();
        toast({
          title: "保存成功",
          description: "题单总结已更新",
        });
      }
    } catch {
      toast({
        title: "保存失败",
        description: "保存题单总结时出错",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEditSummary = () => {
    setEditingSummary(false);
    setTempSummary("");
  };

  const handleAddProblem = async () => {
    if (!newProblemLink.trim()) {
      toast({
        title: "添加失败",
        description: "题目链接不能为空",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // 尝试从 LeetCode API 获取题目标题与难度
      let problemTitle = "";
      let problemDifficulty = "";
      try {
        const titleResult = await window.electron.getLeetcodeProblemTitle(newProblemLink.trim());
        if (titleResult.success) {
          if (titleResult.title) {
            problemTitle = titleResult.title;
          }
          if (titleResult.difficulty) {
            problemDifficulty = titleResult.difficulty;
          }
        }
      } catch {
        // 忽略异常，稍后尝试使用 slug 兜底
      }

      if (!problemTitle) {
        const slug = extractProblemSlug(newProblemLink.trim());
        if (slug) {
          problemTitle = slugToTitle(slug);
        }
      }

      const newProblems = [
        ...(collection.problems || []),
        {
          link: newProblemLink.trim(),
          is_completed: false,
          title: problemTitle,
          difficulty: problemDifficulty,
        },
      ];
      const saved = await window.electron.saveLeetcodeCollection({
        id: collection.id,
        name: collection.name,
        summary: collection.summary,
        problems: newProblems,
      });

      if (saved) {
        setCollection(saved);
        setNewProblemLink("");
        onRefresh();
        toast({
          title: "添加成功",
          description: "题目已添加",
        });
      }
    } catch {
      toast({
        title: "添加失败",
        description: "添加题目时出错",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProblem = async (index: number, problemId?: number) => {
    const problem = collection.problems?.[index];
    if (!problem) return;

    // 如果题目没有 id，说明数据不完整，不应该执行 toggle
    if (!problemId) {
      toast({
        title: "操作失败",
        description: "题目数据不完整，请刷新后重试",
        variant: "destructive",
      });
      return;
    }

    const oldCompleted = problem.is_completed;
    const newCompleted = !oldCompleted;
    const newProblems = [...(collection.problems || [])];
    newProblems[index] = { ...problem, is_completed: newCompleted };

    // 乐观更新
    setCollection({ ...collection, problems: newProblems });

    try {
      await window.electron.updateLeetcodeProblem(problemId, {
        is_completed: newCompleted,
      });
      onRefresh();
    } catch {
      // 回滚：恢复原来的状态
      const rollbackProblems = [...(collection.problems || [])];
      rollbackProblems[index] = { ...problem, is_completed: oldCompleted };
      setCollection({ ...collection, problems: rollbackProblems });
      toast({
        title: "更新失败",
        description: "更新题目状态时出错",
        variant: "destructive",
      });
    }
  };

  const handleDeleteProblem = async (index: number) => {
    const newProblems = [...(collection.problems || [])];
    newProblems.splice(index, 1);

    setSaving(true);
    try {
      const saved = await window.electron.saveLeetcodeCollection({
        id: collection.id,
        name: collection.name,
        summary: collection.summary,
        problems: newProblems,
      });

      if (saved) {
        setCollection(saved);
        onRefresh();
        toast({
          title: "删除成功",
          description: "题目已删除",
        });
      }
    } catch {
      toast({
        title: "删除失败",
        description: "删除题目时出错",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const openProblemLink = (link: string) => {
    if (!link) return;
    try {
      if (window?.electron?.openExternal) {
        window.electron.openExternal(link);
      } else {
        window.open(link, "_blank");
      }
    } catch {
      window.open(link, "_blank");
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <Card className="flex-1 flex flex-col">
        <CardContent className="flex-1 overflow-auto space-y-6">
          {/* 题单名称 */}
          <div className="mt-4">
            {editingName ? (
              <div className="flex items-center">
                <Input
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveName();
                    } else if (e.key === "Escape") {
                      handleCancelEditName();
                    }
                  }}
                  autoFocus
                  className="flex-1"
                />
                <Button size="icon" variant="ghost" onClick={handleSaveName} disabled={saving}>
                  <Save className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={handleCancelEditName}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 group cursor-pointer hover:bg-gray-50 p-2 rounded -ml-2"
                onClick={handleStartEditName}>
                <span className="text-lg font-semibold flex-1">{collection.name}</span>
                <Edit2 className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
          </div>

          {/* 题单总结 */}
          <div>
            {editingSummary ? (
              <div className="space-y-2">
                <Textarea
                  value={tempSummary}
                  onChange={(e) => setTempSummary(e.target.value)}
                  rows={4}
                  className="w-full"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveSummary} disabled={saving}>
                    <Save className="h-4 w-4 mr-1" />
                    保存
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleCancelEditSummary}>
                    <X className="h-4 w-4 mr-1" />
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="group cursor-pointer hover:bg-gray-50 p-2 rounded -ml-2"
                onClick={handleStartEditSummary}>
                <div className="flex items-start justify-between">
                  <p className="text-sm text-gray-700 flex-1 whitespace-pre-wrap">
                    {collection.summary || <span className="text-gray-400">点击添加总结</span>}
                  </p>
                  <Edit2 className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                </div>
              </div>
            )}
          </div>

          {/* 题目列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">题目列表</label>
              <div className="flex items-center gap-2">
                <Input
                  value={newProblemLink}
                  onChange={(e) => setNewProblemLink(e.target.value)}
                  placeholder="输入题目链接"
                  className="w-64"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleAddProblem();
                    }
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleAddProblem}
                  disabled={saving || !newProblemLink.trim()}>
                  <Plus className="h-4 w-4 mr-1" />
                  添加
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {collection.problems?.map((problem, index) => {
                const getDifficultyColor = (difficulty?: string) => {
                  if (!difficulty) return "bg-gray-200 text-gray-600";
                  const d = difficulty.toLowerCase();
                  if (d === "easy") return "bg-green-100 text-green-700";
                  if (d === "medium") return "bg-orange-100 text-orange-700";
                  if (d === "hard") return "bg-red-100 text-red-700";
                  return "bg-gray-200 text-gray-600";
                };
                
                const getDifficultyText = (difficulty?: string) => {
                  if (!difficulty) return "";
                  const d = difficulty.toLowerCase();
                  if (d === "easy") return "Easy";
                  if (d === "medium") return "Medium";
                  if (d === "hard") return "Hard";
                  return difficulty;
                };

                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 border rounded hover:bg-gray-50">
                    <Button
                      size="icon"
                      variant="ghost"
                      className={`h-6 w-6 ${
                        problem.is_completed ? "text-green-600" : "text-gray-400"
                      }`}
                      onClick={() => handleToggleProblem(index, problem.id)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <a
                      href={problem.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex-1 text-sm truncate ${
                        problem.is_completed ? "line-through text-gray-500" : ""
                      }`}
                      title={problem.link}
                      onClick={(e) => {
                        e.preventDefault();
                        openProblemLink(problem.link);
                      }}>
                      {extractProblemTitle(problem.link, problem.title)}
                    </a>
                    {problem.difficulty && (
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getDifficultyColor(problem.difficulty)}`}>
                        {getDifficultyText(problem.difficulty)}
                      </span>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openProblemLink(problem.link)}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDeleteProblem(index)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                );
              })}

              {(!collection.problems || collection.problems.length === 0) && (
                <div className="text-center text-sm text-gray-500 py-8">
                  暂无题目，在上方输入链接添加题目
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
