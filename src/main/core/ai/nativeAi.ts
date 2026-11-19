import { buildSessionPreview as tsBuildSessionPreview } from "../../../shared/ai/aiSessionPreview";
import { nativeCall } from "../system/nativeModules";

interface NativeAi {
  buildSessionPreview(text: string | null, max: number): string;
}

const WRAPPER = "ai-rs.cjs";

export function buildSessionPreview(text: string | null, max?: number): string {
  return nativeCall<string, NativeAi>(
    WRAPPER,
    "buildSessionPreview",
    () => tsBuildSessionPreview(text, max),
    (module) => module.buildSessionPreview(text, max)
  );
}
