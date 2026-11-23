import type { Knex } from "knex";
import type {
  PluginCapabilities,
  PluginGrantRecord,
} from "../../../../shared/plugin/manifest/pluginTypes";
import { grantKeysForCapabilities } from "../../../../shared/plugin/permissions/pluginCapabilities";

export async function syncPluginGrants(
  DB: Knex,
  pluginId: string,
  capabilities?: PluginCapabilities
): Promise<void> {
  if (!pluginId) return;
  const keys = grantKeysForCapabilities(capabilities);
  const rows = await DB("plugin_grant")
    .where("plugin_id", pluginId)
    .select("capability");
  const stored = new Set(rows.map((row) => String(row.capability)));

  const stale = [...stored].filter((key) => !keys.includes(key));
  if (stale.length > 0) {
    await DB("plugin_grant")
      .where("plugin_id", pluginId)
      .whereIn("capability", stale)
      .delete();
  }

  const fresh = keys.filter((key) => !stored.has(key));
  if (fresh.length > 0) {
    const now = new Date();
    await DB("plugin_grant").insert(
      fresh.map((capability) => ({
        plugin_id: pluginId,
        capability,
        granted: 1,
        granted_at: now,
      }))
    );
  }
}

export async function listPluginGrants(
  DB: Knex,
  pluginId: string,
  capabilities?: PluginCapabilities
): Promise<PluginGrantRecord[]> {
  if (!pluginId) return [];
  const rows = await DB("plugin_grant")
    .where("plugin_id", pluginId)
    .select("capability", "granted", "granted_at");
  const byKey = new Map(
    rows.map((row) => [String(row.capability), row] as const)
  );

  return grantKeysForCapabilities(capabilities).map((capability) => {
    const row = byKey.get(capability);
    const grantedAt = row?.granted_at ? new Date(row.granted_at).getTime() : undefined;
    return {
      pluginId,
      capability,
      granted: row ? Number(row.granted) !== 0 : true,
      grantedAt: Number.isFinite(grantedAt) ? grantedAt : undefined,
    };
  });
}

export async function setPluginGrant(
  DB: Knex,
  pluginId: string,
  capability: string,
  granted: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!pluginId) return { ok: false, error: "插件不存在" };
  if (!capability) return { ok: false, error: "权限项不能为空" };

  const now = new Date();
  const existing = await DB("plugin_grant")
    .where("plugin_id", pluginId)
    .where("capability", capability)
    .first();

  if (existing) {
    await DB("plugin_grant")
      .where("plugin_id", pluginId)
      .where("capability", capability)
      .update({
        granted: granted ? 1 : 0,
        granted_at: granted ? now : null,
      });
    return { ok: true };
  }

  await DB("plugin_grant").insert({
    plugin_id: pluginId,
    capability,
    granted: granted ? 1 : 0,
    granted_at: granted ? now : null,
  });
  return { ok: true };
}

export async function isGrantActive(
  DB: Knex,
  pluginId: string,
  capability: string
): Promise<boolean> {
  const row = await DB("plugin_grant")
    .where("plugin_id", pluginId)
    .where("capability", capability)
    .first();
  if (!row) return true;
  return Number(row.granted) !== 0;
}
