import type { PluginCapabilities } from "@shared/plugin/manifest/pluginTypes";
import {
  describeCapabilityEntries,
  type PluginCapabilityEntry,
} from "@shared/plugin/permissions/pluginCapabilities";

export type CapabilityEntry = PluginCapabilityEntry;

export function describeCapabilities(
  capabilities?: PluginCapabilities
): CapabilityEntry[] {
  return describeCapabilityEntries(capabilities);
}

export function capabilitySummary(capabilities?: PluginCapabilities): string[] {
  return describeCapabilities(capabilities).map((entry) => entry.detail);
}
