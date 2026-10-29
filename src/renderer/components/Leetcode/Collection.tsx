import { useState } from "react";
import Sidebar from "./SideBar";
import CollectionDetail from "./CollectionDetail";
import { ListChecks, Sparkles } from "lucide-react";

export default function Collection() {
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="flex h-full w-full">
      <Sidebar
        key={refreshKey}
        onSelectCollection={setSelectedCollectionId}
        selectedCollectionId={selectedCollectionId}
      />
      {selectedCollectionId !== null && (
        <CollectionDetail collectionId={selectedCollectionId} onRefresh={handleRefresh} />
      )}
      {selectedCollectionId === null && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center animate-fade-in-stagger">
            {/* Empty state icon with outer glow ring
                Reuses the same icon-glow-ring pattern as AiChatPanel and ClipboardList
                empty states. The outer blur glow (bg-primary/12, blur-2xl) is an explicit
                positioned div; the ring border is on the inner container. */}
            <div className="relative mb-5 leetcode-empty-icon">
              {/* Outer glow — positioned behind the icon container */}
              <div
                className="absolute inset-0 bg-primary/10 rounded-full blur-2xl scale-90 -top-1 animate-fade-in"
                style={{ animationDelay: "80ms" }}
              />
              {/* Inner container with ring border — sits on top of the glow */}
              <div className="relative w-16 h-16 mx-auto rounded-2xl bg-primary/[0.06] border border-primary/15 flex items-center justify-center icon-glow-ring animate-float">
                <ListChecks className="h-7 w-7 text-primary/60" />
              </div>
            </div>
            <p className="text-base font-medium text-foreground/80 mb-1.5">选择一个题单查看详情</p>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary/40" />
              点击 + 按钮创建新题单
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
