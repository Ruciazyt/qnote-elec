import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";


const SHEET = "/pixel-pet/spritesheet.png";
const CELL = 32;
const SCALE = 2;
const FRAME_PX = CELL * SCALE;

interface PixelPetProps {
  anim: PixelPetAnim;
  className?: string;
}

export type PixelPetAnim = "idle" | "thinking" | "drag";

const ANIM_META: Record<PixelPetAnim, { start: number; frames: number; fps: number }> = {
  idle: { start: 0, frames: 6, fps: 2.5 },
  thinking: { start: 6, frames: 8, fps: 6 },
  drag: { start: 14, frames: 8, fps: 6 },
};

const TOTAL_FRAMES = Object.values(ANIM_META).reduce((sum, m) => sum + m.frames, 0);

const ANIM_LABEL: Record<PixelPetAnim, string> = {
  idle: "戴红围巾的小白狗",
  thinking: "思考中的戴红围巾的小白狗",
  drag: "被拖拽中的戴红围巾的小白狗",
};

export function PixelPet({ anim, className }: PixelPetProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const meta = ANIM_META[anim] ?? ANIM_META.idle;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const frameMs = 1000 / meta.fps;
    let x = meta.start;
    let timer: number | undefined;

    el.style.backgroundPositionX = `${-x * FRAME_PX}px`;

    const tick = () => {
      x = x + 1 >= meta.start + meta.frames ? meta.start : x + 1;
      el.style.backgroundPositionX = `${-x * FRAME_PX}px`;
      timer = window.setTimeout(tick, frameMs);
    };

    timer = window.setTimeout(tick, frameMs);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [anim, meta.start, meta.frames, meta.fps]);

  return (
    <span
      ref={ref}
      role="img"
      aria-label={ANIM_LABEL[anim]}
      className={cn("pixel-pet inline-block", className)}
      style={{
        width: `${FRAME_PX}px`,
        height: `${FRAME_PX}px`,
        backgroundImage: `url(${SHEET})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${TOTAL_FRAMES * FRAME_PX}px ${FRAME_PX}px`,
      }}
    />
  );
}
