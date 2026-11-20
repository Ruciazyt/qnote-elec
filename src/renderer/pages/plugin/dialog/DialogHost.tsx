import * as React from "react";
import { PublishDialog } from "../PublishDialog";
import { StartConfirmDialog } from "../StartConfirmDialog";
import type { DialogContext, DialogMessage } from "@shared/plugin/dialogTypes";
import type { StartConfirmation } from "@shared/plugin/pluginTypes";

interface PublishTarget {
  name: string;
  description: string;
  manifest: string;
  pluginId: string;
}

function readPublishTarget(payload: Record<string, unknown>): PublishTarget | null {
  const name = String(payload.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    description: String(payload.description ?? ""),
    manifest: String(payload.manifest ?? ""),
    pluginId: String(payload.pluginId ?? ""),
  };
}

function readConfirmation(payload: Record<string, unknown>): StartConfirmation | null {
  const pluginId = String(payload.pluginId ?? "").trim();
  if (!pluginId) return null;
  return payload as unknown as StartConfirmation;
}

export function DialogHost() {
  const [context, setContext] = React.useState<DialogContext | null>(null);

  React.useEffect(() => {
    let alive = true;
    const off = window.electron.onDialogContext((next) => {
      if (alive) setContext(next);
    });
    void (async () => {
      try {
        const loaded = await window.electron.dialogGetContext();
        if (alive && loaded) setContext(loaded);
      } catch (err) {
        console.error("读取弹框上下文失败", err);
      }
    })();
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!context) return null;

  if (context.type === "publish") {
    const target = readPublishTarget(context.payload);
    if (!target) return null;
    return (
      <PublishDialog
        target={target}
        onClose={() => {
          window.electron.dialogSend({ action: "cancelled" });
        }}
      />
    );
  }

  if (context.type === "start-confirm") {
    const confirmation = readConfirmation(context.payload);
    if (!confirmation) return null;
    return (
      <StartConfirmDialog
        confirmation={confirmation}
        onClose={() => {
          window.electron.dialogSend({ action: "cancelled" });
        }}
      />
    );
  }

  return null;
}

export type { DialogMessage };
