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
import { NoteFileEntry } from "../../../../shared/noteTypes";
import type { NoteEditorHandle } from "../editorHandle";
import { useTheme } from "@/hooks/useTheme";

// 定义在组件外：放在组件体内会让父组件每次 re-render 都产生新对象，触发 Excalidraw 重渲染
const CUSTOM_UI_OPTIONS: UIOptions = {
  canvasActions: {
    saveToActiveFile: false,
    export: { saveFileToDisk: false },
  },
};

interface ExcalidrawEditorProps {
  /** 当前打开的文件；null 表示空白画布 */
  file: NoteFileEntry | null;
  dirPath: string | null;
  /** 触发「另存为」菜单项 */
  onRequestSaveAs: () => void;
  /** 触发「保存到当前文件」菜单项 */
  onRequestSave: () => void;
  onSaved: (fileName: string) => void;
  /** 画布容器，用于粘贴图片时判断焦点是否在画布内（画布自己处理粘贴） */
  containerRef: React.RefObject<HTMLDivElement>;
}

const ExcalidrawEditor = forwardRef<NoteEditorHandle, ExcalidrawEditorProps>(function ExcalidrawEditor(
  { file, dirPath, onRequestSaveAs, onRequestSave, onSaved, containerRef },
  ref
) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  /* 画布主题跟随应用主题
     之前这里自己监听 prefers-color-scheme，等于绕过用户在设置页选的档位 ——
     系统是浅色但用户选了深色时，画布仍是白的，和周围割裂。
     改用全局 store 的 resolvedTheme（"跟随系统"时它本身就跟着系统走）。 */
  const { resolvedTheme } = useTheme();

  const relPath = file?.relPath ?? null;
  /**
   * 已经灌进画布的条目路径。
   * 切到别的标签再切回来时依赖没变，但 Excalidraw 组件并没有被卸载，
   * 画布内容还在 —— 这里再 load 一次反而会把用户的改动冲掉。
   */
  const loadedRelRef = useRef<string | null>(null);
  /**
   * 画布有没有未保存改动。
   * 用于外部变更检测：白板文件在磁盘上被改掉时，若本地有改动就不能直接重载覆盖。
   * 灌入场景本身不算改动 —— 那由 onChange 的 elements 深度判断自然过滤掉，
   * 因为加载完成后场景里每个元素都已落盘、内容不会再变。
   */
  const [dirty, setDirty] = useState(false);
  /**
   * 重载信号。reload() 只递增它，由 effect 依赖它来重新执行加载分支 ——
   * Excalidraw 组件本身不会卸载，光改 loadedRelRef 不会触发 effect。
   */
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!relPath || !dirPath) return;
    if (loadedRelRef.current === relPath && reloadNonce === 0) return;

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
        loadedRelRef.current = relPath;
        // 刚灌进来的内容不算用户改动
        setDirty(false);
      } catch (err) {
        console.error("加载白板失败", relPath, err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [relPath, dirPath, file?.name, reloadNonce]);

  /** 序列化当前画布 —— 绘图笔记的落盘格式 */
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
          // 另存为后父组件会改 file，这里先记下，避免 effect 重新灌一遍画布
          loadedRelRef.current = target;
          setDirty(false);
          onSaved(target);
        }
        return ok;
      },
      isDirty: () => dirty,
      reload: async () => {
        // 清掉短路标记 + 递增信号，effect 会重新走一遍加载分支
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
        /* 任何场景变化都算「有改动」，先粗粒度标记。
           加载场景紧随其后的 setDirty(false) 会把它压掉，
           不需要在这里去逐个比对元素 —— 那样成本高且容易漏。 */
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

export default ExcalidrawEditor;
