import { useEffect, useState } from "react";
import { getRoutePath, subscribeRoutePath } from "./routeStore";

export function useRouteActive(path: string): boolean {
  const [active, setActive] = useState(() => getRoutePath() === path);

  useEffect(() => {
    const update = () => setActive(getRoutePath() === path);
    update();
    return subscribeRoutePath(update);
  }, [path]);

  return active;
}
