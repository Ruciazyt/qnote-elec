import { useState } from "react";
import { Copy, Image as ImageIcon, Clipboard } from "lucide-react";
import type { IslandClipboardItem } from "../useIslandData";
import { relativeTime } from "../format";

interface ClipboardPanelProps {
  items: IslandClipboardItem[];
  onCopied: (message: string) => void;
}

/**
 * 剪贴板页
 *
 * 点一条就复制 —— 岛是「随手取用」的地方，复制完继续干别的，
 * 不该跳回主窗口。
 */
export function ClipboardPanel({ items, onCopied }: ClipboardPanelProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = async (item: IslandClipboardItem) => {
    setCopiedId(item.id);
    try {
      const result = await window.electron.popupCopyClipboardItem(item.id);
      if (result?.success) {
        onCopied("已复制");
      } else {
        onCopied("复制失败");
      }
    } catch {
      onCopied("复制失败");
    } finally {
      setTimeout(() => setCopiedId(null), 1200);
    }
  };

  if (items.length === 0) {
    return (
      <div className="island-empty">
        <Clipboard size={22} strokeWidth={1.5} className="island-icon-muted" />
        <div className="island-empty-title">剪贴板还是空的</div>
      </div>
    );
  }

  return (
    <div>
      {items.map((item) => {
        const isImage = item.type === "image";
        return (
          <button
            key={item.id}
            type="button"
            className="island-row"
            onClick={() => void handleCopy(item)}
            title={isImage ? "点击复制这张图片" : item.content}
          >
            {isImage ? (
              <img
                src={item.content}
                alt=""
                className="w-9 h-9 rounded-md object-cover flex-shrink-0"
              />
            ) : (
              <ImageIcon size={14} strokeWidth={1.5} className="island-icon-muted mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="island-row-content">{isImage ? "图片" : item.content}</div>
              <div className="island-row-meta">
                {relativeTime(new Date(item.time).getTime())}
                {copiedId === item.id ? " · 已复制" : ""}
              </div>
            </div>
            <Copy size={13} strokeWidth={1.5} className="island-icon-muted mt-1 flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
