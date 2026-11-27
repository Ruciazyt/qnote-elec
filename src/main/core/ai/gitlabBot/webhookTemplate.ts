import * as os from "node:os";

export const GITLAB_WEBHOOK_EVENT_KEYS = [
  "push_events",
  "tag_push_events",
  "note_events",
  "issues_events",
  "confidential_issues_events",
  "merge_requests_events",
  "job_events",
  "pipeline_events",
  "wiki_page_events",
  "releases_events",
] as const;

export type GitlabWebhookEventKey =
  (typeof GITLAB_WEBHOOK_EVENT_KEYS)[number];

export interface GitlabWebhookTemplate {
  url: string;
  token?: string;
  signing_token?: string;
  enable_ssl_verification: boolean;
  push_events: boolean;
  tag_push_events: boolean;
  note_events: boolean;
  issues_events: boolean;
  confidential_issues_events: boolean;
  merge_requests_events: boolean;
  job_events: boolean;
  pipeline_events: boolean;
  wiki_page_events: boolean;
  releases_events: boolean;
}

export const GITLAB_WEBHOOK_DEFAULT_EVENTS: Record<
  GitlabWebhookEventKey,
  boolean
> = {
  push_events: false,
  tag_push_events: false,
  note_events: true,
  issues_events: true,
  confidential_issues_events: false,
  merge_requests_events: true,
  job_events: false,
  pipeline_events: false,
  wiki_page_events: false,
  releases_events: false,
};

export function resolveLanAddress(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const isIPv4 =
        entry.family === "IPv4" || (entry.family as unknown) === 4;
      if (!isIPv4 || entry.internal) continue;
      candidates.push(entry.address);
    }
  }
  return candidates[0] ?? "127.0.0.1";
}

export function buildWebhookUrl(port: number, host?: string): string {
  const address =
    host && host !== "0.0.0.0" && host !== "::" ? host : resolveLanAddress();
  return `http://${address}:${port}/gitlab/webhook`;
}

export function buildWebhookTemplate(options: {
  port: number;
  secretToken: string;
  signingToken?: string;
  host?: string;
  events?: Partial<Record<GitlabWebhookEventKey, boolean>>;
}): GitlabWebhookTemplate {
  const events = { ...GITLAB_WEBHOOK_DEFAULT_EVENTS, ...(options.events ?? {}) };
  const template: GitlabWebhookTemplate = {
    url: buildWebhookUrl(options.port, options.host),
    enable_ssl_verification: false,
    push_events: events.push_events,
    tag_push_events: events.tag_push_events,
    note_events: events.note_events,
    issues_events: events.issues_events,
    confidential_issues_events: events.confidential_issues_events,
    merge_requests_events: events.merge_requests_events,
    job_events: events.job_events,
    pipeline_events: events.pipeline_events,
    wiki_page_events: events.wiki_page_events,
    releases_events: events.releases_events,
  };
  if (options.secretToken) template.token = options.secretToken;
  if (options.signingToken) template.signing_token = options.signingToken;
  return template;
}

export function maskWebhookSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}******${secret.slice(-4)}`;
}
