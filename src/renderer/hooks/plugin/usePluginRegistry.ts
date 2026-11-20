import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PluginRecord,
  PluginRuntimeState,
} from "@shared/plugin/pluginTypes";

export interface PluginRegistry {
  plugins: PluginRecord[];
  runtime: Record<string, PluginRuntimeState>;
  pluginNames: Record<string, string>;
  reload: () => Promise<void>;
}

export function usePluginRegistry(): PluginRegistry {
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [runtime, setRuntime] = useState<Record<string, PluginRuntimeState>>({});

  const reload = useCallback(async () => {
    try {
      const [list, states] = await Promise.all([
        window.electron.pluginList(),
        window.electron.pluginRuntimeStates(),
      ]);
      setPlugins(list);
      setRuntime(Object.fromEntries(states.map((s) => [s.pluginId, s])));
    } catch (err) {
      console.error("读取插件清单失败", err);
    }
  }, []);

  useEffect(() => {
    void reload();
    const offPlugins = window.electron.onPluginPluginsChanged((next) => {
      setPlugins(next);
    });
    const offRuntime = window.electron.onPluginRuntimeChanged((state) => {
      setRuntime((prev) => ({ ...prev, [state.pluginId]: state }));
    });
    return () => {
      offPlugins();
      offRuntime();
    };
  }, [reload]);

  const pluginNames = useMemo(
    () =>
      Object.fromEntries(plugins.map((p) => [p.id, p.name])),
    [plugins]
  );

  return { plugins, runtime, pluginNames, reload };
}
