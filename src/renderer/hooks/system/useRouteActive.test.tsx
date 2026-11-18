import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { publishRoutePath } from "./routeStore";
import { useRouteActive } from "./useRouteActive";

describe("useRouteActive", () => {
  afterEach(() => {
    act(() => {
      publishRoutePath("/");
    });
  });

  it("路由命中时为真，切走后又变回假", () => {
    const { result } = renderHook(() => useRouteActive("/notes"));
    expect(result.current).toBe(false);

    act(() => {
      publishRoutePath("/notes");
    });
    expect(result.current).toBe(true);

    act(() => {
      publishRoutePath("/todos");
    });
    expect(result.current).toBe(false);
  });

  it("切到不相关的路由时不触发重渲染", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useRouteActive("/notes");
    });

    const before = renders;
    act(() => {
      publishRoutePath("/todos");
    });

    expect(renders).toBe(before);
    expect(result.current).toBe(false);
  });

  it("重复发布同一个路径不会触发重渲染", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useRouteActive("/notes");
    });

    act(() => {
      publishRoutePath("/notes");
    });
    const afterHit = renders;
    expect(result.current).toBe(true);

    act(() => {
      publishRoutePath("/notes");
    });

    expect(renders).toBe(afterHit);
    expect(result.current).toBe(true);
  });
});
