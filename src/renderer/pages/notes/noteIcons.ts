import type { ElementType } from "react";
import { Code2, FileText, ImageIcon, PenTool } from "lucide-react";
import type { NoteType } from "../../../shared/notes/noteTypes";

export const NOTE_TYPE_ICONS: Record<NoteType, ElementType> = {
  excalidraw: PenTool,
  markdown: FileText,
  html: Code2,
  image: ImageIcon,
  pdf: FileText,
};
