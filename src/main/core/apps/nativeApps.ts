import { analyzeCommand as tsAnalyzeCommand } from "../../../shared/apps/appRisk";
import type { RiskReport } from "../../../shared/apps/appRisk";
import { nativeCall } from "../system/nativeModules";

interface NativeApps {
  analyzeCommand(command: string, args: string[]): RiskReport;
}

const WRAPPER = "apps-rs.cjs";

export function analyzeCommand(command: string, args: string[] = []): RiskReport {
  return nativeCall<RiskReport, NativeApps>(
    WRAPPER,
    "analyzeCommand",
    () => tsAnalyzeCommand(command, args),
    (module) => module.analyzeCommand(command, args)
  );
}
