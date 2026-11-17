import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import "@excalidraw/excalidraw/index.css";
import { Excalidraw, MainMenu, WelcomeScreen, loadFromBlob } from "@excalidraw/excalidraw";
import { ExcalidrawImperativeAPI, UIOptions } from "@excalidraw/excalidraw/types";
import { Save } from "lucide-react";
import { NoteFileEntry } from "../../../../shared/notes/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";
import { useTheme } from "@/hooks/shell/useTheme";

const CUSTOM_UI_OPTIONS: UIOptions = {
  canvasActions: {
    saveToActiveFile: false,
    export: { saveFileToDisk: false },
  },
};

interface ExcalidrawEditorProps {
  file: NoteFileEntry | null;
  dirPath: string | null;
  onRequestSaveAs: () => void;
  onRequestSave: () => void;
  onSaved: (fileName: string) => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

const ExcalidrawEditor = forwardRef<NoteEditorHandle, ExcalidrawEditorProps>(function ExcalidrawEditor(
  { file, dirPath, onRequestSaveAs, onRequestSave, onSaved, containerRef },
  ref
) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const { resolvedTheme } = useTheme();

  const relPath = file?.relPath ?? null;
  const loadedRelRef = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!relPath || !dirPath) return;
    const key = `${dirPath}\u0000${relPath}`;
    if (loadedRelRef.current === key && reloadNonce === 0) return;

    let cancelled = false;
    void (async () => {
      const content = await window.electron.readNote(dirPath, relPath);
      if (cancelled || !content || content.type !== "excalidraw") return;

      const api = apiRef.current;
      if (!api) return;

      try {
        const blob = new Blob([content.text], { type: "application/json" });
        const scene = await loadFromBlob(blob, null, null);
        if (cancelled) return;
        api.addFiles(Object.values(scene.files));
        api.updateScene({
          ...scene,
          appState: { ...scene.appState, fileHandle: { name: file?.name } },
        });
        loadedRelRef.current = key;
        setDirty(false);
      } catch (err) {
        console.error("加载白板失败", relPath, err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relPath, dirPath, file?.name, reloadNonce]);

  const serialize = useCallback((): string => {
    const api = apiRef.current;
    if (!api) return "";
    return JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: window.location.origin,
      elements: api.getSceneElements(),
      appState: api.getAppState(),
      files: api.getFiles ? api.getFiles() : {},
    });
  }, []);

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      currentRelPath: () => relPath,
      hasContent: () => relPath !== null,
      save: async (targetRelPath) => {
        if (!dirPath) return false;
        const api = apiRef.current;
        if (!api) return false;
        const target = targetRelPath ?? relPath;
        if (!target) return false;
        const ok = await window.electron.writeNote(dirPath, target, serialize());
        if (ok) {
          loadedRelRef.current = `${dirPath}\u0000${target}`;
          setDirty(false);
          onSaved(target);
        }
        return ok;
      },
      isDirty: () => dirty,
      reload: async () => {
        loadedRelRef.current = null;
        setReloadNonce((n) => n + 1);
      },
    }),
    [dirPath, relPath, serialize, onSaved, dirty]
  );

  return (
    <div className="h-full w-full" ref={containerRef}>
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        onChange={() => setDirty(true)}
        theme={resolvedTheme}
        langCode="zh-CN"
        UIOptions={CUSTOM_UI_OPTIONS}
      >
        <WelcomeScreen />
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.Item icon={<Save />} onSelect={onRequestSaveAs} shortcut="Ctrl+Shift+S">
            另存为
          </MainMenu.Item>
          <MainMenu.Item
            icon={<Save />}
            onSelect={onRequestSave}
            shortcut="Ctrl+S"
            disabled={!relPath}
          >
            保存到当前文件{file ? ` - ${file.name}` : ""}
          </MainMenu.Item>
        </MainMenu>
      </Excalidraw>
    </div>
  );
});

export default React.memo(ExcalidrawEditor);
