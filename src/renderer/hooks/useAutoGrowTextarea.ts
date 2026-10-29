import { useCallback, useEffect, useRef } from "react";

/**
 * 让 textarea 随内容长高，而不是横向滚动
 *
 * 单行 <input> 装不下长文本时，文字会一路向右推、用户在框里只看得见末尾几个字，
 * 必须横向滚动才能回头确认自己写了什么。AI 输入框尤其吃亏：这里的 prompt
 * 动辄一两百字，"看不见自己写了什么"会直接让人失去信心。
 *
 * 换成 textarea 后由浏览器负责换行，剩下的只是把高度同步给内容：
 *   1. 先把 height 归零再量 scrollHeight —— 不归零的话高度只增不减，
 *      删字之后框不会缩回去；
 *   2. 量到的值写回 height，配合 CSS 的 max-height 封顶（最多 N 行）；
 *   3. 触顶时 clientHeight 会小于 scrollHeight，此时才需要滚动条，
 *      没触顶时保持 hidden，免得 Chromium 的滚动条占掉横向空间。
 *
 * 上限交给 CSS，这里不去算行高 —— 行高受字体加载和缩放影响，算出来的高度
 * 迟早对不上真正的渲染结果。
 */
export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.overflowY = "hidden";
    const next = el.scrollHeight;
    el.style.height = `${next}px`;
    el.style.overflowY = next > el.clientHeight ? "auto" : "hidden";
  }, []);

  // 跟着内容走而不是跟着事件走：值可能在别处被清空（发送后），
  // 那样就没有 onChange 可挂，收缩必须由这个 effect 兜住。
  useEffect(() => {
    resize();
  }, [value, resize]);

  return ref;
}