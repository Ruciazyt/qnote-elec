import type { ElementType } from "react";
import { Code2, FileText, ImageIcon, PenTool } from "lucide-react";
import type { NoteType } from "../../../shared/noteTypes";

/**
 * 笔记类型 → 图标
 *
 * 单独抽出来是因为图标映射有两处在用：文件树的行首图标、右键菜单里的
 * 「新建文件」类型子菜单。两处各写一份的话，加新类型时容易只改一处 ——
 * 菜单里点得到、行首却显示成别的图标。
 */
export const NOTE_TYPE_ICONS: Record<NoteType, ElementType> = {
  excalidraw: PenTool,
  markdown: FileText,
  html: Code2,
  image: ImageIcon,
  pdf: FileText,
};
