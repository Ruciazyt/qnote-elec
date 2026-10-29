import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import "./titleBar.css";

/* 产品名固定为 QNote。
   之前走 window.electron.getAppInfo() 读 app.getName()，而根 package.json
   只在 build.productName 里写了 QNote、顶层 name 是小写 qnote，dev 下 Electron
   解析不到就回退成框架默认名 "Electron"，标题栏因此显示成了 Electron。
   打包后本来就显示 QNote，这里直接写死，dev / prod 一致，也省掉一次 IPC 往返。 */
const APP_NAME = "QNote";

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const unsubscribe = window.electron.onWindowMaximized((nextIsMaximized) => {
      setIsMaximized(nextIsMaximized);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleMinimize = () => {
    window.electron.minimizeWindow();
  };

  const handleMaximize = () => {
    window.electron.maximizeWindow();
  };

  const handleClose = () => {
    window.electron.closeWindow();
  };

  return (
    <>
      {/* 左侧内容区域 - 标题栏 */}
      <div className="h-10 w-[calc(100%-120px)] title-drag fixed top-0 left-0 z-50 px-2 flex items-center space-x-2">
        <img
          src="./icon.ico"
          alt="icon"
          className="h-5 w-5 border-none outline-none select-none object-contain"
        />
        <p className="truncate">{APP_NAME}</p>
      </div>

      {/* 右侧控制按钮 - 固定宽度120px */}
      <div className="h-10 w-[120px] fixed right-0 top-0 flex z-50 title-drag">
        <button
          type="button"
          className="h-10 w-10 flex items-center justify-center no-drag window-btn-minimize"
          onClick={handleMinimize}
          title="最小化"
          aria-label="最小化">
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="h-10 w-10 flex items-center justify-center no-drag window-btn-maximize"
          onClick={handleMaximize}
          title={isMaximized ? "还原" : "最大化"}
          aria-label={isMaximized ? "还原窗口" : "最大化窗口"}>
          {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="h-10 w-10 flex items-center justify-center no-drag"
          onClick={handleClose}
          title="关闭"
          aria-label="关闭">
          <X className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}
