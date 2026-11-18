
import { useState } from "react";
import { Sparkles } from "lucide-react";
import SkillSection from "./SkillSection";
import McpSection from "./McpSection";

type TabKey = "skills" | "mcp";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "skills", label: "技能" },
  { key: "mcp", label: "MCP 服务器" },
];

export default function SkillsPage() {
  const [tab, setTab] = useState<TabKey>("skills");

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <div className="max-w-5xl mx-auto w-full">
        <div className="mb-6 sm:mb-8 flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">技能 / MCP</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              提示词技能一键套用，MCP 服务器把外部能力接进 AI 对话
            </p>
          </div>
        </div>

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

        {tab === "skills" ? <SkillSection /> : <McpSection />}
      </div>
    </div>
  );
}
