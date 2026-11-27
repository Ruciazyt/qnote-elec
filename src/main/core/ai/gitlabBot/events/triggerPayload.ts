import { gitlabGet } from "../../tools/gitlab/api/client";
import { gitlabEndpoints } from "../../tools/gitlab/api/endpoints";

export const TRIGGER_PAYLOAD_KEY = "TRIGGER_PAYLOAD";

export interface TriggerPayloadResult {
  ok: boolean;
  payload: unknown;
  reason?: string;
}

/**
 * 从 GitLab 读回 pipeline 上的 TRIGGER_PAYLOAD 原文。
 *
 * CI job 不用 file 类型变量传报文 —— 那个变量由 runner 生成文件，
 * Windows 的 PowerShell executor 会把内容原样拼进脚本，反引号与中文都会把脚本搞坏。
 * job 只带 pipeline id 过来，原始报文从这里取。
 */
export async function loadTriggerPayload(options: {
  projectId: number;
  pipelineId: number;
}): Promise<TriggerPayloadResult> {
  try {
    const data = await gitlabGet<
      Array<{ key?: string; value?: string; variable_type?: string }>
    >(
      gitlabEndpoints.pipelineVariables(
        String(options.projectId),
        options.pipelineId
      )
    );
    const list = Array.isArray(data) ? data : [];
    const hit = list.find((item) => item.key === TRIGGER_PAYLOAD_KEY);
    if (!hit?.value) {
      return {
        ok: false,
        payload: null,
        reason: "pipeline 上没有 " + TRIGGER_PAYLOAD_KEY + " 变量",
      };
    }
    try {
      return { ok: true, payload: JSON.parse(hit.value) };
    } catch {
      return {
        ok: false,
        payload: null,
        reason: TRIGGER_PAYLOAD_KEY + " 不是合法 JSON",
      };
    }
  } catch (err) {
    return {
      ok: false,
      payload: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
