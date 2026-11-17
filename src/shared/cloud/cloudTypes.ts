
export type CloudBackend = "local" | "d1" | "public";

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export interface CloudStorageConfig {
  backend: CloudBackend;
  d1: D1Config | null;
  endpoint: string | null;
  lastCheck?: CloudConnectionStatus | null;
}

export interface CloudConnectionStatus {
  ok: boolean;
  error?: string;
  databaseName?: string;
  tableCount?: number;
  detail?: string;
}

export interface PublishedApp {
  id: string;
  name: string;
  description: string;
  author: string;
  manifest: string;
  repoUrl: string;
  tags: string;
  pulls: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublishedAppInput {
  name: string;
  description?: string;
  author?: string;
  manifest: string;
  repoUrl?: string;
  tags?: string;
}

export interface PublishedAppQuery {
  keyword?: string;
  limit?: number;
  offset?: number;
}

export interface PublishedAppListResult {
  apps: PublishedApp[];
  total: number;
}
