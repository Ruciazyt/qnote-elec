import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const STORE_FILE = "floating-ai-state.json";

export interface FloatingPosition {
  right: number;
  bottom: number;
}

export interface FloatingState {
  position: FloatingPosition;
  expanded: boolean;
}

const DEFAULT_STATE: FloatingState = {
  position: { right: 20, bottom: 20 },
  expanded: true,
};

/**
 * 跨窗口共享运行期浮框状态；位置只在当前应用进程内同步，展开状态持久化。
 * 所有渲染进程（主窗口、剪贴板 popup、AI popup）通过 IPC 读写同一份数据。
 */
class FloatingPanelStore {
  private state: FloatingState = { ...DEFAULT_STATE };
  private loaded = false;
  private writeQueue: ReturnType<typeof setTimeout> | null = null;

  private getStorePath(): string {
    return path.join(app.getPath("userData"), STORE_FILE);
  }

  private load(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.getStorePath(), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.expanded === "boolean") {
          this.state.expanded = parsed.expanded;
        }
      }
    } catch {
      // 文件不存在或解析失败 — 使用默认值
    }
    this.loaded = true;
  }

  /** 异步防抖写入，避免拖动时高频写盘 */
  private scheduleSave(): void {
    if (this.writeQueue) return;
    this.writeQueue = setTimeout(() => {
      this.writeQueue = null;
      try {
        fs.writeFileSync(
          this.getStorePath(),
          JSON.stringify({ expanded: this.state.expanded }, null, 2),
          "utf8"
        );
      } catch (err) {
        console.error("[floating-panel] 保存失败:", err);
      }
    }, 200);
  }

  getState(): FloatingState {
    this.load();
    return { ...this.state };
  }

  getPosition(): FloatingPosition {
    this.load();
    return { ...this.state.position };
  }

  setPosition(position: FloatingPosition): void {
    this.load();
    if (
      typeof position.right !== "number" ||
      typeof position.bottom !== "number"
    ) {
      return;
    }
    this.state.position = {
      right: Math.max(0, position.right),
      bottom: Math.max(0, position.bottom),
    };
  }

  setExpanded(expanded: boolean): void {
    this.load();
    this.state.expanded = !!expanded;
    this.scheduleSave();
  }
}

export const floatingPanelStore = new FloatingPanelStore();