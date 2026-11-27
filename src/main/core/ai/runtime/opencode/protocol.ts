export const OPENCODE_EVENT_PATH = "/event";
export const OPENCODE_HEALTH_PATH = "/global/health";

export interface OpencodeCredentials {
  username: string;
  password: string;
}

export interface OpencodeEventEnvelope {
  id: string;
  type: string;
  properties: Record<string, any>;
}

export interface OpencodeTokens {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

export interface OpencodeMessageError {
  name?: string;
  data?: { message?: string; statusCode?: number; isRetryable?: boolean };
}

export interface OpencodeMessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  time: { created: number; completed?: number };
  error?: OpencodeMessageError | null;
  cost?: number;
  tokens?: OpencodeTokens;
  modelID?: string;
  providerID?: string;
}

export interface OpencodePartBase {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  time?: { start?: number; end?: number };
}

export interface OpencodeTextPart extends OpencodePartBase {
  type: "text";
  text: string;
}

export interface OpencodeReasoningPart extends OpencodePartBase {
  type: "reasoning";
  text: string;
}

export interface OpencodeToolStatePending {
  status: "pending" | "running";
  input?: Record<string, any>;
  raw?: string;
  title?: string;
  time?: { start?: number; end?: number };
}

export interface OpencodeToolStateCompleted {
  status: "completed";
  input?: Record<string, any>;
  output: string;
  title?: string;
  metadata?: Record<string, any>;
  time?: { start?: number; end?: number; compacted?: boolean };
  attachments?: any[];
}

export interface OpencodeToolStateError {
  status: "error";
  input?: Record<string, any>;
  error: string;
  metadata?: Record<string, any>;
  time?: { start?: number; end?: number };
}

export type OpencodeToolState =
  | OpencodeToolStatePending
  | OpencodeToolStateCompleted
  | OpencodeToolStateError;

export interface OpencodeToolPart extends OpencodePartBase {
  type: "tool";
  callID: string;
  tool: string;
  state: OpencodeToolState;
}

export type OpencodePart =
  | OpencodeTextPart
  | OpencodeReasoningPart
  | OpencodeToolPart
  | (OpencodePartBase & Record<string, any>);

export interface OpencodeMessageWithParts {
  info: OpencodeMessageInfo;
  parts: OpencodePart[];
}

export type OpencodeAssistantResponse = OpencodeMessageWithParts;

export interface OpencodeSession {
  id: string;
  title?: string;
  directory?: string;
  path?: string;
  cost?: number;
  tokens?: OpencodeTokens;
  metadata?: Record<string, any>;
}

export interface OpencodeModelRef {
  providerID: string;
  modelID: string;
}

export interface OpencodeTextPartInput {
  type: "text";
  text: string;
}

export interface OpencodeFilePartInput {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export type OpencodePartInput = OpencodeTextPartInput | OpencodeFilePartInput;

export interface OpencodePromptOptions {
  parts: OpencodePartInput[];
  system?: string;
  model?: OpencodeModelRef;
  agent?: string;
  tools?: Record<string, boolean>;
  messageID?: string;
}

export interface OpencodeCreateSessionOptions {
  title?: string;
  agent?: string;
  model?: OpencodeModelRef;
  metadata?: Record<string, any>;
  directory?: string;
}

export type OpencodePermissionReply = "once" | "always" | "reject";

export interface OpencodePermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  tool?: string;
  metadata?: Record<string, any>;
  always?: string[];
}

export interface OpencodeHealth {
  healthy: boolean;
  version?: string;
}

export function normalizeToolOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output ?? "");
}
