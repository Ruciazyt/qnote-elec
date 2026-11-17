export interface NoteEditorHandle {
  currentRelPath(): string | null;
  hasContent(): boolean;
  save(relPath?: string): Promise<boolean>;

  isDirty?(): boolean;

  reload?(): Promise<void>;
}