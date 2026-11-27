import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAiAssistant } from "@/hooks/ai/useAiAssistant";
import { useNativeViewCover } from "@/hooks/plugin/useNativeViewCover";
import { useVoiceInput } from "@/hooks/ai/useVoiceInput";
import { toast } from "@/hooks/ui/use-toast";
import { AiChatPanel } from "./AiChatPanel";
import { AiChatSessionsPanel } from "./AiChatSessionsPanel";
import { PixelPet } from "./PixelPet";
import { PetSpeechBubble, BUBBLE_WIDTH } from "./PetSpeechBubble";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 560;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 360;
const PANEL_EDGE_GAP = 16;
const BALL_SIZE = 64;
const TITLE_BAR_HEIGHT = 40;
const DRAG_THRESHOLD_PX = 3;

interface PanelPosition {
  right: number;
  bottom: number;
}

type OpenSide = "left" | "right";

type ResizeDirection = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

interface PanelResizeStart extends PanelPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: ResizeDirection;
}

const RESIZE_HANDLES: {
  direction: ResizeDirection;
  label: string;
  className: string;
}[] = [
  { direction: "n", label: "上边缘", className: "inset-x-3 top-0 h-2 cursor-ns-resize" },
  { direction: "e", label: "右边缘", className: "inset-y-3 right-0 w-2 cursor-ew-resize" },
  { direction: "s", label: "下边缘", className: "inset-x-3 bottom-0 h-2 cursor-ns-resize" },
  { direction: "w", label: "左边缘", className: "inset-y-3 left-0 w-2 cursor-ew-resize" },
  { direction: "nw", label: "左上角", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize rounded-tl-lg" },
  { direction: "ne", label: "右上角", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize rounded-tr-lg" },
  { direction: "se", label: "右下角", className: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize rounded-br-lg" },
  { direction: "sw", label: "左下角", className: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize rounded-bl-lg" },
];

const BUBBLE_GAP = 10;
const BUBBLE_VIEWPORT_MARGIN = 12;
const BUBBLE_TAIL_INSET = 16;

function clampPosition(pos: PanelPosition, panelWidth: number, panelHeight: number): PanelPosition {
  const maxRight = Math.max(0, window.innerWidth - panelWidth);
  const maxBottom = Math.max(
    0,
    window.innerHeight - panelHeight - TITLE_BAR_HEIGHT
  );
  return {
    right: Math.min(Math.max(0, pos.right), maxRight),
    bottom: Math.min(Math.max(0, pos.bottom), maxBottom),
  };
}

function resolveOpenSide(ballRight: number, panelWidth: number): OpenSide {
  const vw = window.innerWidth;
  const ballLeft = ballRight - BALL_SIZE;
  const roomLeft = ballRight;
  const roomRight = vw - ballLeft;

  if (roomLeft >= panelWidth) return "left";
  if (roomRight >= panelWidth) return "right";
  return roomLeft >= roomRight ? "left" : "right";
}

function fitPanel(
  ballRight: number,
  ballBottom: number,
  panelSize: { width: number; height: number },
  openSide: OpenSide
): { size: { width: number; height: number }; position: PanelPosition } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ballLeft = ballRight - BALL_SIZE;

  const room = openSide === "left" ? ballRight : vw - ballLeft;
  const width = clampPanelDimension(
    panelSize.width,
    MIN_PANEL_WIDTH,
    room - PANEL_EDGE_GAP
  );
  const height = clampPanelDimension(
    panelSize.height,
    MIN_PANEL_HEIGHT,
    vh - TITLE_BAR_HEIGHT - PANEL_EDGE_GAP
  );

  const left = openSide === "left" ? ballRight - width : ballLeft;
  return {
    size: { width, height },
    position: {
      right: Math.max(0, vw - left - width),
      bottom: Math.min(
        ballBottom,
        Math.max(0, vh - height - TITLE_BAR_HEIGHT)
      ),
    },
  };
}

function clampPanelDimension(value: number, min: number, available: number): number {
  const max = Math.max(1, available);
  return Math.min(Math.max(value, Math.min(min, max)), max);
}

function resizePanelFromDelta(
  start: PanelResizeStart,
  horizontalDelta: number,
  verticalDelta: number
): { size: { width: number; height: number }; position: PanelPosition } {
  let width = start.width;
  let height = start.height;
  let right = start.right;
  let bottom = start.bottom;

  if (start.direction.includes("w")) {
    width = clampPanelDimension(
      start.width - horizontalDelta,
      MIN_PANEL_WIDTH,
      window.innerWidth - start.right
    );
  } else if (start.direction.includes("e")) {
    width = clampPanelDimension(
      start.width + horizontalDelta,
      MIN_PANEL_WIDTH,
      start.width + start.right
    );
    right = Math.max(0, start.right - (width - start.width));
  }

  if (start.direction.includes("n")) {
    height = clampPanelDimension(
      start.height - verticalDelta,
      MIN_PANEL_HEIGHT,
      window.innerHeight - start.bottom - TITLE_BAR_HEIGHT
    );
  } else if (start.direction.includes("s")) {
    height = clampPanelDimension(
      start.height + verticalDelta,
      MIN_PANEL_HEIGHT,
      start.height + start.bottom
    );
    bottom = Math.max(0, start.bottom - (height - start.height));
  }

  return { size: { width, height }, position: { right, bottom } };
}

export function FloatingAiAssistant() {
  const ai = useAiAssistant();
  const coveredByNativeView = useNativeViewCover();

  const voice = useVoiceInput({
    onTranscribed: (text) => ai.sendPetVoiceMessage(text),
  });

  const handleVoiceToggle = useCallback(async () => {
    const idle = voice.phase === "idle" || voice.phase === "error";
    if (idle) {
      ai.beginPetVoice();
      await voice.toggle();
      return;
    }
    if (voice.phase === "recording" || voice.phase === "starting") {
      ai.patchPetBubble({ phase: "transcribing" });
      await voice.toggle();
    }
  }, [ai, voice]);

  useEffect(() => {
    return window.electron.onVoiceHotkeyTriggered(() => {
      if (coveredByNativeView) {
        toast({
          title: "当前页面无法显示语音气泡",
          description: "内嵌浏览器页面会遮挡浮动界面，请切回其它页面后再试。",
        });
        return;
      }
      void handleVoiceToggle();
    });
  }, [coveredByNativeView, handleVoiceToggle]);

  useEffect(() => {
    if (voice.error && ai.petBubble) {
      ai.patchPetBubble({ phase: "error", error: voice.error });
    }
  }, [voice.error, ai]);

  const [expanded, setExpanded] = useState<boolean>(true);
  const [panelSize, setPanelSize] = useState({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
  const panelSizeRef = useRef(panelSize);
  panelSizeRef.current = panelSize;
  const [position, setPosition] = useState<PanelPosition>({ right: 20, bottom: 20 });
  const [openSide, setOpenSide] = useState<OpenSide>("left");
  const [stateReady, setStateReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const dragStartRef = useRef<{
    x: number;
    y: number;
    right: number;
    bottom: number;
    moved: boolean;
  } | null>(null);
  const resizeStartRef = useRef<PanelResizeStart | null>(null);

  const setPanelSizeAndPosition = useCallback(
    (next: { size: { width: number; height: number }; position: PanelPosition }) => {
      setPanelSize(next.size);
      setPosition(next.position);
    },
    []
  );

  const suppressNextClickRef = useRef(false);

  const positionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPositionRef = useRef<PanelPosition | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.electron.getFloatingAiState();
        if (cancelled) return;
        if (state.position) {
          if (state.expanded) {
            setPosition(
              clampPosition(
                state.position,
                panelSizeRef.current.width,
                panelSizeRef.current.height
              )
            );
          } else {
            setPosition(state.position);
          }
        }
        if (typeof state.expanded === "boolean") setExpanded(state.expanded);
      } catch (err) {
        console.error("[floating-ai] 加载跨窗口状态失败", err);
      } finally {
        if (!cancelled) setStateReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const offPos = window.electron.onFloatingAiPositionUpdated((p) => {
      if (isInteractingRef.current) return;
      setPosition(p);
      if (expanded) {
        const panelRight = window.innerWidth - p.right;
        const ballRight =
          openSide === "left" ? panelRight : panelRight + panelSize.width - BALL_SIZE;
        setPanelSizeAndPosition(fitPanel(ballRight, p.bottom, panelSize, openSide));
      }
    });
    const offExp = window.electron.onFloatingAiExpandedUpdated((e) => {
      setExpanded(e);
    });
    return () => {
      offPos();
      offExp();
    };
  }, [expanded, openSide, panelSize, setPanelSizeAndPosition]);

  const syncPositionToMain = useCallback((next: PanelPosition, immediate = false) => {
    pendingPositionRef.current = next;
    if (immediate) {
      if (positionSyncTimerRef.current) {
        clearTimeout(positionSyncTimerRef.current);
        positionSyncTimerRef.current = null;
      }
      window.electron.setFloatingAiPosition(next);
      pendingPositionRef.current = null;
      return;
    }
    if (positionSyncTimerRef.current) return;
    positionSyncTimerRef.current = setTimeout(() => {
      positionSyncTimerRef.current = null;
      if (pendingPositionRef.current) {
        window.electron.setFloatingAiPosition(pendingPositionRef.current);
        pendingPositionRef.current = null;
      }
    }, 50);
  }, []);

  const syncExpandedToMain = useCallback((next: boolean) => {
    window.electron.setFloatingAiExpanded(next);
  }, []);

  useEffect(() => {
    if (!stateReady) return;
    if (isDragging || isResizing) return;
    syncPositionToMain(position, true);
  }, [position, stateReady, isDragging, isResizing, syncPositionToMain]);

  useEffect(() => {
    if (!stateReady) return;
    syncExpandedToMain(expanded);
  }, [expanded, stateReady, syncExpandedToMain]);

  useEffect(() => {
    const handleResize = () => {
      if (!expanded) {
        setPosition((prev) =>
          clampPosition(prev, BALL_SIZE, BALL_SIZE)
        );
        return;
      }
      const panelRight = window.innerWidth - position.right;
      const ballRight = openSide === "left" ? panelRight : panelRight + panelSize.width - BALL_SIZE;
      setPanelSizeAndPosition(fitPanel(ballRight, position.bottom, panelSize, openSide));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [expanded, openSide, panelSize, position.right, position.bottom, setPanelSizeAndPosition]);

  useEffect(() => {
    return () => {
      if (positionSyncTimerRef.current) {
        clearTimeout(positionSyncTimerRef.current);
      }
    };
  }, []);

  const isInteractingRef = useRef(false);
  useEffect(() => {
    isInteractingRef.current = isDragging || isResizing;
  }, [isDragging, isResizing]);

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        start.moved = true;
      }
      const w = expanded ? panelSize.width : BALL_SIZE;
      const h = expanded ? panelSize.height : BALL_SIZE;
      const rawRight = start.right - dx;
      const rawBottom = start.bottom - dy;
      const maxRight = Math.max(0, window.innerWidth - w);
      const maxBottom = Math.max(
        0,
        window.innerHeight - h - TITLE_BAR_HEIGHT
      );
      const next: PanelPosition = {
        right: Math.min(Math.max(0, rawRight), maxRight),
        bottom: Math.min(Math.max(0, rawBottom), maxBottom),
      };
      setPosition(next);
      syncPositionToMain(next);
    };

    const onUp = () => {
      const start = dragStartRef.current;
      if (start?.moved) {
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 100);
      }
      if (positionSyncTimerRef.current) {
        clearTimeout(positionSyncTimerRef.current);
        positionSyncTimerRef.current = null;
      }
      if (pendingPositionRef.current) {
        syncPositionToMain(pendingPositionRef.current, true);
      }
      dragStartRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging, expanded, panelSize, syncPositionToMain]);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;

      const next = resizePanelFromDelta(
        start,
        e.clientX - start.x,
        e.clientY - start.y
      );
      setPanelSize(next.size);
      setPosition(next.position);
    };

    const onUp = () => {
      resizeStartRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isResizing]);

  const beginDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        right: position.right,
        bottom: position.bottom,
        moved: false,
      };
      setIsDragging(true);
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
      }
    },
    [position]
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, direction: ResizeDirection) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: panelSize.width,
        height: panelSize.height,
        right: position.right,
        bottom: position.bottom,
        direction,
      };
      setIsResizing(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
      }
    },
    [panelSize, position]
  );

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, direction: ResizeDirection) => {
      const step = e.shiftKey ? 32 : 16;
      let horizontalDelta = 0;
      let verticalDelta = 0;
      if (e.key === "ArrowLeft") horizontalDelta = -step;
      else if (e.key === "ArrowRight") horizontalDelta = step;
      else if (e.key === "ArrowUp") verticalDelta = -step;
      else if (e.key === "ArrowDown") verticalDelta = step;
      else return;

      if (!direction.includes("e") && !direction.includes("w")) {
        horizontalDelta = 0;
      }
      if (!direction.includes("n") && !direction.includes("s")) {
        verticalDelta = 0;
      }
      if (horizontalDelta === 0 && verticalDelta === 0) return;

      e.preventDefault();
      e.stopPropagation();
      const next = resizePanelFromDelta(
        {
          x: 0,
          y: 0,
          width: panelSize.width,
          height: panelSize.height,
          right: position.right,
          bottom: position.bottom,
          direction,
        },
        horizontalDelta,
        verticalDelta
      );
      setPanelSize(next.size);
      setPosition(next.position);
    },
    [panelSize, position]
  );

  const handleExpand = useCallback(() => {
    if (!expanded) {
      const ballRight = window.innerWidth - position.right;
      const side = resolveOpenSide(ballRight, panelSize.width);
      setOpenSide(side);
      setPanelSizeAndPosition(fitPanel(ballRight, position.bottom, panelSize, side));
    }
    setExpanded(true);
  }, [expanded, position.right, position.bottom, panelSize, setPanelSizeAndPosition]);

  const handleCollapse = useCallback(() => {
    if (openSide === "right") {
      const panelLeft = window.innerWidth - position.right - panelSize.width;
      setPosition((prev) => ({
        ...prev,
        right: Math.max(0, window.innerWidth - panelLeft - BALL_SIZE),
      }));
    }
    setExpanded(false);
  }, [openSide, position.right, panelSize.width]);

  const handleBallPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => beginDrag(e),
    [beginDrag]
  );

  const handleCardHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => beginDrag(e),
    [beginDrag]
  );

  const handleBallClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      handleExpand();
    },
    [handleExpand]
  );

  const bubbleStyle = useMemo(() => {
    const containerHeight = expanded ? panelSize.height : BALL_SIZE;
    const maxWidth = Math.max(
      200,
      Math.min(BUBBLE_WIDTH, window.innerWidth - BUBBLE_VIEWPORT_MARGIN * 2)
    );
    const maxRight = Math.max(
      BUBBLE_VIEWPORT_MARGIN,
      window.innerWidth - maxWidth - BUBBLE_VIEWPORT_MARGIN
    );
    const right = Math.min(Math.max(BUBBLE_VIEWPORT_MARGIN, position.right), maxRight);

    const petCenterFromRight = position.right + BALL_SIZE / 2;
    const tailOffset = Math.min(
      Math.max(BUBBLE_TAIL_INSET, petCenterFromRight - right),
      Math.max(BUBBLE_TAIL_INSET, maxWidth - BUBBLE_TAIL_INSET)
    );

    return {
      width: maxWidth,
      right,
      bottom: position.bottom + containerHeight + BUBBLE_GAP,
      tailOffset,
    };
  }, [expanded, panelSize.height, position.right, position.bottom]);

  return (
    <>
      {}
      <div
        className="fixed z-40"
        style={{
          display: coveredByNativeView ? "none" : undefined,
          right: `${position.right}px`,
          bottom: `${position.bottom}px`,
          width: expanded ? panelSize.width : BALL_SIZE,
          height: expanded ? panelSize.height : BALL_SIZE,
          transition: isDragging || isResizing
            ? "none"
            : "right 200ms ease-out, bottom 200ms ease-out, width 300ms ease-out, height 300ms ease-out",
        }}>
        {expanded ? (
          <div
            className="h-full w-full bg-card shadow-2xl rounded-lg border border-border/60 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 origin-bottom-right duration-200"
            role="dialog"
            aria-label="AI 助手">
            {}
            <FloatingCardHeader
              aiLoading={ai.aiLoading}
              isDragging={isDragging}
              assistantView={ai.assistantView}
              activeSessionTitle={ai.activeChatSession?.title ?? "新建对话"}
              sessionCount={ai.chatSessions.length}
              isCreatingSession={ai.isCreatingSession}
              onHeaderPointerDown={handleCardHeaderPointerDown}
              onShowSessions={ai.handleShowSessions}
              onNewChat={ai.handleNewChat}
              onCollapse={handleCollapse}
            />
            <div className="flex-1 min-h-0">
              {ai.assistantView === "sessions" ? (
                <AiChatSessionsPanel
                  sessions={ai.chatSessions}
                  isLoading={ai.sessionsLoading}
                  isCreatingSession={ai.isCreatingSession}
                  aiInput={ai.aiInput}
                  aiLoading={ai.aiLoading}
                  onNewChat={ai.handleNewChat}
                  onSelectSession={ai.handleOpenChatSession}
                  onDeleteSession={ai.handleDeleteChatSession}
                  onInputChange={ai.setAiInput}
                  onKeyDown={ai.handleKeyDown}
                  onSendAiMessage={ai.handleSendAiMessage}
                  aiImages={ai.aiImages}
                  onAddAiImages={ai.addAiImages}
                  onRemoveAiImage={ai.removeAiImage}
                />
              ) : (
                <AiChatPanel
                  chatMessages={ai.chatMessages}
                  aiInput={ai.aiInput}
                  aiLoading={ai.aiLoading}
                  isHistoryLoading={ai.chatHistoryLoading}
                  streamingMessage={ai.streamingMessage}
                  compacting={ai.compacting}
                  skills={ai.skills}
                  activeSkillId={ai.activeSkillId}
                  onSelectSkill={ai.setActiveSkillId}
                  aiImages={ai.aiImages}
                  onAddAiImages={ai.addAiImages}
                  onRemoveAiImage={ai.removeAiImage}
                  onSendAiMessage={ai.handleSendAiMessage}
                  onCancelAiMessage={ai.handleCancelAiMessage}
                  onInputChange={ai.setAiInput}
                  onKeyDown={ai.handleKeyDown}
                  className="bg-card"
                />
              )}
            </div>
            {RESIZE_HANDLES.map(({ direction, label, className }) => (
              <button
                key={direction}
                type="button"
                onPointerDown={(e) => handleResizePointerDown(e, direction)}
                onKeyDown={(e) => handleResizeKeyDown(e, direction)}
                className={cn(
                  "absolute z-10 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  className
                )}
                aria-label={`调整 AI 助手大小：${label}`}
                title={`拖动${label}调整大小`}
              />
            ))}
          </div>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onPointerDown={handleBallPointerDown}
                  onClick={handleBallClick}
                  className={cn(
                    "group relative flex items-center justify-center",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background",
                    "animate-in fade-in origin-bottom-right duration-200",
                    isDragging ? "pixel-pet-dragging" : "pixel-pet-action"
                  )}
                  style={{ width: BALL_SIZE, height: BALL_SIZE }}
                  aria-label="展开 AI 助手">
                  {
}
                  <PixelPet
                    anim={isDragging ? "drag" : ai.aiLoading ? "thinking" : "idle"}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={8}>
                <p className="text-xs">展开 AI 助手 · 可拖动</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {
}
      {ai.petBubble && !expanded && !coveredByNativeView && (
        <div
          className="fixed z-40"
          style={{
            right: `${bubbleStyle.right}px`,
            bottom: `${bubbleStyle.bottom}px`,
            width: `${bubbleStyle.width}px`,
          }}>
          <PetSpeechBubble
            state={ai.petBubble}
            level={voice.level}
            onDismiss={ai.dismissPetBubble}
            tailOffset={bubbleStyle.tailOffset}
          />
        </div>
      )}
    </>
  );
}

function FloatingCardHeader({
  aiLoading,
  isDragging,
  assistantView,
  activeSessionTitle,
  sessionCount,
  isCreatingSession,
  onHeaderPointerDown,
  onShowSessions,
  onNewChat,
  onCollapse,
}: {
  aiLoading: boolean;
  isDragging: boolean;
  assistantView: "sessions" | "chat";
  activeSessionTitle: string;
  sessionCount: number;
  isCreatingSession: boolean;
  onHeaderPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onShowSessions: () => void;
  onNewChat: () => void;
  onCollapse: () => void;
}) {
  return (
    <div
      onPointerDown={onHeaderPointerDown}
      className={cn(
        "flex items-center justify-between px-3 py-2 bg-card shrink-0 select-none",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}>
      <div className="flex items-center gap-2 min-w-0">
          {assistantView === "chat" && (
            <Button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onShowSessions}
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 hover:bg-muted"
              aria-label="返回会话列表"
              title="返回会话列表">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
        <div className="relative h-7 w-7 rounded-lg bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
          <Bot className="h-4 w-4 text-primary" />
          {aiLoading && (
            <span className="absolute inset-0 rounded-lg ring-1 ring-primary/30 animate-pulse" />
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-medium text-sm leading-tight truncate">
            {assistantView === "sessions" ? "Sessions" : activeSessionTitle}
          </h3>
          <p className="text-[10px] text-muted-foreground/70 leading-tight">
            {assistantView === "sessions"
              ? `${sessionCount} 个对话`
              : aiLoading
                ? "思考中…"
                : "AI 助手"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onNewChat}
                disabled={isCreatingSession}
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-muted"
                aria-label="新建对话"
                title="新建对话">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">新建对话</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onCollapse}
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-muted"
                aria-label="收起为悬浮球">
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <p className="text-xs">收起</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}