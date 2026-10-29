/**
 * 笔记编辑器的统一句柄契约
 *
 * 父组件（NotesPage）不关心当前挂的是哪个编辑器 ——
 * 它只拿着一个 ref，调用 save() / currentRelPath() 即可。
 * 这样「Ctrl+S 保存到当前文件」「另存为」这些交互对所有类型都是同一套代码。
 *
 * 写入位置一律由父组件决定：编辑器只知道内容，不关心存到哪个文件夹。
 */
export interface NoteEditorHandle {
  /** 当前打开条目的相对路径；空白状态返回 null */
  currentRelPath(): string | null;
  /** 当前是否有可保存的内容（决定「保存到当前文件」是否可用） */
  hasContent(): boolean;
  /**
   * 保存。
   * @param relPath 传入则另存到该路径；不传则覆盖当前文件。
   * @returns 是否保存成功
   */
  save(relPath?: string): Promise<boolean>;

  /**
   * 有未保存改动。
   *
   * 只读编辑器（图片 / PDF）恒为 false。存在意义是外部变更检测 ——
   * 文件在磁盘上被改掉时，若本地有未保存内容就不能直接丢弃重载。
   */
  isDirty?(): boolean;

  /**
   * 丢弃内存内容，从磁盘重新载入当前条目。
   *
   * 只读编辑器可以不做实现（父组件应先isDirty() 判断再决定要不要调）。
   * 文本类必须实现，否则外部改动永远反映不到正在打开的那一篇上。
   */
  reload?(): Promise<void>;
}