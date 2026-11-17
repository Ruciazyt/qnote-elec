import { useLocation } from "react-router";

export function useRouteActive(path: string): boolean {
  const { pathname } = useLocation();
  return pathname === path;
}
