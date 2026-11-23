
export type CloudBackend = "local" | "catalog";

export interface CatalogConfig {
  baseUrl: string;
  appId: string;
  publicKey: string;
  privateKey: string;
}

export interface CatalogDefaults {
  baseUrl: string;
  appId: string;
}

export interface CloudStorageConfig {
  backend: CloudBackend;
  catalog: CatalogConfig | null;
  lastCheck?: CloudConnectionStatus | null;
  catalogDefaults?: CatalogDefaults;
}

export interface CloudConnectionStatus {
  ok: boolean;
  error?: string;
  databaseName?: string;
  tableCount?: number;
  detail?: string;
}

export interface PublishedAppDependency {
  id: string;
  range?: string;
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
  version?: string;
  dependencies?: PublishedAppDependency[];
  bundle?: string;
  bundleDropped?: boolean;
  versionDropped?: boolean;
  dependenciesDropped?: boolean;
}

export interface PublishedAppInput {
  name: string;
  description?: string;
  author?: string;
  manifest: string;
  repoUrl?: string;
  tags?: string;
  version?: string;
  dependencies?: PublishedAppDependency[];
  bundle?: string;
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
