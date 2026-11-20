import { analyzeCommand as tsAnalyzeCommand } from "../../../shared/plugin/pluginRisk";
import type { RiskReport } from "../../../shared/plugin/pluginRisk";
import { nativeCall } from "../system/nativeModules";

interface NativePlugin {
  analyzeCommand(command: string, args: string[]): RiskReport;
}

const WRAPPER = "plugin-rs.cjs";

export function analyzeCommand(command: string, args: string[] = []): RiskReport {
  return nativeCall<RiskReport, NativePlugin>(
    WRAPPER,
    "analyzeCommand",
    () => tsAnalyzeCommand(command, args),
    (module) => module.analyzeCommand(command, args)
  );
}
