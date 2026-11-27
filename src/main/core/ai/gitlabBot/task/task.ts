import { createHash } from "node:crypto";
import { configManager } from "../../../system/config";
import { log } from "../../../system/log";
import { ensureAiChatSession } from "../../chatSession";
import {
  removeAiChatRow,
  startAiChatAssistantRow,
  updateAiChatAssistantRow,
} from "../../chatPersistence";
import { emitAiChatChanged } from "../../chatEvents";
import { BlockBuilder } from "../../../../../shared/ai/aiBlocks";
import {
  buildOpencodeParts,
  toOpencodeProvider,
} from "../../runtime/opencode/bridge";
import { getOpencodeRuntime } from "../../runtime/opencode/runtime";
import type { OpencodeDriverResult } from "../../runtime/opencode/driver";
import { QNOTE_CODE_AGENT_NAME } from "../../runtime/opencode/profile";
import { resolveToolDisplay } from "../../tools/index";
import { buildTaskPrompt } from "./prompt";
import type { GitlabEvent } from "../events/webhook";

export function gitlabSessionId(projectPath: string, key: string): string {
  const hash = createHash("sha1")
    .update(`gitlab:${projectPath}#${key}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

export function gitlabTaskKey(event: GitlabEvent): string {
  if (event.mrIid) return `mr-${event.mrIid}`;
  if (event.issueIid) return `issue-${event.issueIid}`;
  return "adhoc";
}

export interface RunTaskOptions {
  DB: any;
  event: GitlabEvent;
  instruction: string;
  repoDir: string;
  branch: string;
  defaultBranch: string;
  allowPush: boolean;
}

const FLUSH_INTERVAL_MS = 1000;

export interface RunTaskResult {
  ok: boolean;
  text: string;
  error?: string;
}

export async function runGitlabTask(
  options: RunTaskOptions
): Promise<RunTaskResult> {
  const aiConfig = await configManager.getAiConfig();
  if (!aiConfig.apiKey) {
    return { ok: false, text: "", error: "没配 AI API Key" };
  }

  const provider = toOpencodeProvider(aiConfig);
  const key = gitlabTaskKey(options.event);
  const chatSessionId = gitlabSessionId(options.event.projectPath, key);
  const title = `GitLab ${options.event.projectPath}#${key}`;
  await ensureAiChatSession(options.DB, chatSessionId, title);

  const prompt = buildTaskPrompt({
    event: options.event,
    instruction: options.instruction,
    repoDir: options.repoDir,
    branch: options.branch,
    defaultBranch: options.defaultBranch,
    allowPush: options.allowPush,
  });
  const parts = buildOpencodeParts({ message: prompt });

  const blockBuilder = new BlockBuilder();
  let text = "";
  let failure = "";
  const runtime = getOpencodeRuntime();

  const rowId = await startAiChatAssistantRow(
    options.DB,
    chatSessionId,
    options.instruction
  );

  let flushTimer: NodeJS.Timeout | null = null;
  let writing = false;
  let writeQueued = false;

  const composeContent = (): string => {
    const base = text.trim() ? text : "";
    if (!failure) return base;
    return base
      ? `${base}\n\n任务执行失败：${failure}`
      : `任务执行失败：${failure}`;
  };

  const writeRow = async (): Promise<void> => {
    if (writing) {
      writeQueued = true;
      return;
    }
    writing = true;
    try {
      await updateAiChatAssistantRow(
        options.DB,
        rowId,
        composeContent(),
        blockBuilder.blocks()
      );
      emitAiChatChanged(chatSessionId);
    } catch (err) {
      log.error("[gitlab-bot] 落库失败", err);
    } finally {
      writing = false;
      if (writeQueued) {
        writeQueued = false;
        await writeRow();
      }
    }
  };

  const scheduleWrite = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void writeRow();
    }, FLUSH_INTERVAL_MS);
  };

  const stopFlushTimer = (): void => {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  let result: OpencodeDriverResult;
  try {
    result = await runtime.runTurn({
      chatSessionId,
      parts,
      provider,
      directory: options.repoDir,
      agentName: QNOTE_CODE_AGENT_NAME,
      handlers: {
        onThinking: (delta) => {
          blockBuilder.pushThinking(delta);
          scheduleWrite();
        },
        onText: (delta) => {
          text += delta;
          blockBuilder.pushText(delta);
          scheduleWrite();
        },
        onToolCall: (call) => {
          const display = resolveToolDisplay(call.name);
          blockBuilder.pushToolCall({
            id: call.id,
            name: display.name,
            title: display.title,
            args: call.args,
          });
          scheduleWrite();
        },
        onToolResult: (toolResult) => {
          blockBuilder.pushToolResult(
            toolResult.id,
            toolResult.content,
            toolResult.isError
          );
          scheduleWrite();
        },
      },
    });
    failure = result.error ?? "";
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    stopFlushTimer();
    await writeRow();
    throw err;
  }

  stopFlushTimer();
  await writeRow();

  const blocks = blockBuilder.blocks();
  if (!composeContent() && !blocks.length) {
    await removeAiChatRow(options.DB, rowId);
  }

  if (result.error) {
    return { ok: false, text, error: result.error };
  }
  return { ok: true, text };
}
