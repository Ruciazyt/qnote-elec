import { FileText } from "lucide-react";
import type { IslandRecentNote } from "@shared/island/island";
import { relativeTime } from "../format";

interface NotesPanelProps {
  notes: IslandRecentNote[];
  onOpenNote: (relPath: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  excalidraw: "手绘",
  markdown: "Markdown",
  html: "网页",
  image: "图片",
  pdf: "PDF",
};

export function NotesPanel({ notes, onOpenNote }: NotesPanelProps) {
  if (notes.length === 0) {
    return (
      <div className="island-empty">
        <FileText size={22} strokeWidth={1.5} className="island-icon-muted" />
        <div className="island-empty-title">还没有笔记</div>
      </div>
    );
  }

  return (
    <div>
      {notes.map((note) => (
        <button
          key={note.relPath}
          type="button"
          className="island-row"
          onClick={() => onOpenNote(note.relPath)}
          title={note.relPath}
        >
          <FileText size={14} strokeWidth={1.5} className="island-icon-muted mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="island-row-title">{note.name}</div>
            <div className="island-row-meta">
              {TYPE_LABELS[note.type] ?? note.type} · {relativeTime(note.mtime)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
