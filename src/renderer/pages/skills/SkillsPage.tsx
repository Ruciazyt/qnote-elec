
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import SkillSection from "./SkillSection";
import McpSection from "./McpSection";
import ToolsSection from "./ToolsSection";

type TabKey = "skills" | "tools" | "mcp";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "skills", label: "技能" },
  { key: "tools", label: "工具" },
  { key: "mcp", label: "MCP 服务器" },
];

export default function SkillsPage() {
  const [tab, setTab] = useState<TabKey>("skills");

  return (
    <div className="px-6 py-8">
      <div className="w-full">
        <PageHeader
          className="mb-8"
          icon={Sparkles}
          title="技能 / MCP"
          subtitle="提示词技能一键套用，内置工具与 MCP 服务器把外部能力接进 AI 对话"
        />

        <div
          role="tablist"
          aria-label="技能与 MCP"
          className="mb-5 inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-1"
        >
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={
                tab === item.key
                  ? "rounded-md bg-primary/10 px-3 py-1.5 text-[13px] font-medium text-foreground"
                  : "rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted transition-colors"
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "skills" ? (
          <SkillSection />
        ) : tab === "tools" ? (
          <ToolsSection />
        ) : (
          <McpSection />
        )}
      </div>
    </div>
  );
}
