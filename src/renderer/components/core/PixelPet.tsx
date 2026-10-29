import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * PixelPet —— 像素宠物渲染组件
 *
 * 渲染一张横向 spritesheet，用 background-position + steps() 做逐帧动画。
 *
 * 为什么不用 <img> + GIF：
 * - GIF 有自己的帧率控制，与 CSS 动画抢主线程，切换状态时会掉帧
 * - GIF 无法按状态切换，只能整体替换文件
 * - spritesheet + steps 完全由 CSS 驱动，状态切换只是换 background-position
 *
 * 为什么必须 image-rendering: pixelated：
 * 浏览器默认对图片做双线性插值，像素块边缘会被混成半透明灰边，
 * 整张图看起来像"模糊的像素画"而不是像素画。这是像素渲染最常见的失败。
 *
 * 为什么尺寸必须是整数倍：
 * 32px 单元格放大到 64px（2 倍）是整数倍，边界落在像素格上。
 * 若渲染成 56px 这类非整数倍，会产生半像素边界，同样出现糊边。
 */

const SHEET = "/pixel-pet/spritesheet.png";
const CELL = 32;
const SCALE = 2;
/** 单元格渲染尺寸（像素），必须等于 CELL * 整数码 */
const FRAME_PX = CELL * SCALE; // 64

interface PixelPetProps {
  /** 当前动画状态 */
  anim: PixelPetAnim;
  /** 额外 className */
  className?: string;
}

/** 可用动画状态 —— 与 scripts/pixel-pet/src/pet.mjs 的 ANIMATIONS 保持一致 */
export type PixelPetAnim = "idle" | "thinking" | "drag";

/** 各动画在图集中的起始帧与帧数 —— 与 pet.json 保持一致 */
const ANIM_META: Record<PixelPetAnim, { start: number; frames: number; fps: number }> = {
  idle: { start: 0, frames: 6, fps: 2.5 },
  thinking: { start: 6, frames: 8, fps: 6 },
  drag: { start: 14, frames: 8, fps: 6 },
};

/**
 * 图集总帧数 —— 必须由 ANIM_META 推导，不能写死。
 *
 * background-size 写死的话，加一个动画就会漏改这里：
 * 表现是 background-position-x 的位移量对不上，角色会横向平移而不是换帧。
 * 这个值只要与总帧数一致，多加动画就自动生效。
 */
const TOTAL_FRAMES = Object.values(ANIM_META).reduce((sum, m) => sum + m.frames, 0);

/**
 * 无障碍标签：状态不同，屏幕阅读器读到的描述也应不同
 *
 * 角色本身由 scripts/pixel-pet/src/from-image.mjs 从 assets/scarf-dog.png 生成，
 * 换源图时记得同步改这三个描述，否则读屏用户听到的还是上一只宠物。
 */
const ANIM_LABEL: Record<PixelPetAnim, string> = {
  idle: "戴红围巾的小白狗",
  thinking: "思考中的戴红围巾的小白狗",
  drag: "被拖拽中的戴红围巾的小白狗",
};

export function PixelPet({ anim, className }: PixelPetProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const meta = ANIM_META[anim] ?? ANIM_META.idle;

  /**
   * 用 Web Animations API 驱动精灵帧。
   *
   * 之所以不用纯 CSS keyframes：图集是横向排列且所有动画共享一张图，
   * 每增加一个动画就要写一组 @keyframes，帧数一多规则会迅速膨胀。
   * 这里直接在 JS 里按 fps 推进 background-positionX，
   * 动画时长由帧数和 fps 推导，改帧只需改 ANIM_META。
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const frameMs = 1000 / meta.fps;
    let x = meta.start;
    let timer: number | undefined;

    // 立即定位到该动画的首帧，避免切换动画时残留上一段的位置
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
