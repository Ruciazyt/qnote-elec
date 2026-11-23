import { compareSemver, parseSemver } from "../manifest/pluginManifest";

export type UpgradeDecisionReason =
  | "available"
  | "same-version"
  | "installed-newer"
  | "unknown-version";

export interface UpgradeDecision {
  available: boolean;
  reason: UpgradeDecisionReason;
  currentVersion: string;
  latestVersion: string;
}

export function evaluateUpgrade(
  currentVersion: string | undefined,
  latestVersion: string | undefined
): UpgradeDecision {
  const current = String(currentVersion ?? "").trim();
  const latest = String(latestVersion ?? "").trim();

  if (!latest) {
    return {
      available: false,
      reason: "unknown-version",
      currentVersion: current,
      latestVersion: latest,
    };
  }

  if (!current) {
    return {
      available: true,
      reason: "available",
      currentVersion: current,
      latestVersion: latest,
    };
  }

  const currentSemver = parseSemver(current);
  const latestSemver = parseSemver(latest);

  if (!currentSemver || !latestSemver) {
    if (current === latest) {
      return {
        available: false,
        reason: "same-version",
        currentVersion: current,
        latestVersion: latest,
      };
    }
    return {
      available: true,
      reason: "available",
      currentVersion: current,
      latestVersion: latest,
    };
  }

  const diff = compareSemver(latestSemver, currentSemver);
  if (diff > 0) {
    return {
      available: true,
      reason: "available",
      currentVersion: current,
      latestVersion: latest,
    };
  }
  if (diff === 0) {
    return {
      available: false,
      reason: "same-version",
      currentVersion: current,
      latestVersion: latest,
    };
  }
  return {
    available: false,
    reason: "installed-newer",
    currentVersion: current,
    latestVersion: latest,
  };
}
