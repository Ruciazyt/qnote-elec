
import type { CatalogConfig } from "../../shared/cloud/cloudTypes";

export interface CatalogRequest {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}

export interface CatalogColumn {
  col: string;
  data_type?: string;
  nullable?: boolean;
}

export interface CatalogResult {
  columns: CatalogColumn[];
  rows: Array<Record<string, unknown>>;
  code: number;
  message: string;
  rowCount: number;
  rowAffect: number;
}

export interface CatalogTransport {
  request(req: CatalogRequest): Promise<CatalogResult>;
}

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    readonly cause?: unknown,
    readonly gatewayBlocked = false
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class CatalogClient implements CatalogTransport {
  constructor(
    private readonly config: CatalogConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  async request(req: CatalogRequest): Promise<CatalogResult> {
    const url = this.buildUrl(req);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: this.authorization(),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: req.method,
        headers,
        body: req.method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new CatalogError(
          `公共目录请求超时（${DEFAULT_TIMEOUT_MS}ms）`,
          undefined,
          undefined,
          error
        );
      }
      throw new CatalogError(
        `连不上公共目录：${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined,
        error
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await readBody(response);
    if (body.parseError) {
      throw new CatalogError(
        describeUnparsedResponse(response.status, body.raw),
        response.status,
        undefined,
        body.parseError,
        response.status === 403
      );
    }

    const parsed = parseCatalogPayload(body.parsed);

    if (!response.ok) {
      throw new CatalogError(
        parsed.message || `公共目录请求失败（HTTP ${response.status}）`,
        response.status,
        parsed.code
      );
    }

    if (parsed.code !== 0 && parsed.code !== 200) {
      throw new CatalogError(
        parsed.message || "公共目录执行 SQL 失败",
        response.status,
        parsed.code
      );
    }

    return parsed;
  }

  private authorization(): string {
    const raw = `${this.config.publicKey}:${this.config.privateKey}`;
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }

  private buildUrl(req: CatalogRequest): string {
    const base = trimTrailingSlash(this.config.baseUrl);
    const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
    const url = `${base}/api/v1beta/app/${encodeURIComponent(
      this.config.appId
    )}/endpoint${path}`;

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value === undefined) continue;
      query.set(key, String(value));
    }
    const search = query.toString();
    return search ? `${url}?${search}` : url;
  }
}

interface RawBody {
  raw: string;
  parsed?: unknown;
  parseError?: unknown;
}

async function readBody(response: Response): Promise<RawBody> {
  try {
    const raw = await response.text();
    try {
      return { raw, parsed: JSON.parse(raw) };
    } catch (error) {
      return { raw, parseError: error };
    }
  } catch {
    try {
      return { raw: "", parsed: await response.json() };
    } catch (error) {
      return { raw: "", parseError: error };
    }
  }
}

function describeUnparsedResponse(status: number, raw: string): string {
  if (status === 403) {
    return "公共目录的网关拦下了这次请求（HTTP 403，不是 API Key 的问题）—— 公共目录不接受内容里带具体 IP 地址的链接";
  }
  const excerpt = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  return `公共目录响应不是合法 JSON（HTTP ${status}）${excerpt ? `：${excerpt}` : ""}`;
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export function parseCatalogPayload(payload: unknown): CatalogResult {
  const root = (payload ?? {}) as {
    data?: {
      columns?: unknown;
      rows?: unknown;
      result?: {
        code?: number;
        message?: string;
        row_count?: number;
        row_affect?: number;
      };
    };
  };

  const data = root.data ?? {};
  const columns = Array.isArray(data.columns)
    ? (data.columns as CatalogColumn[])
    : [];
  const rows = Array.isArray(data.rows)
    ? (data.rows.filter(
        (row) => row && typeof row === "object" && !Array.isArray(row)
      ) as Array<Record<string, unknown>>)
    : [];
  const result = data.result ?? {};

  return {
    columns,
    rows,
    code: Number(result.code ?? 0),
    message: String(result.message ?? ""),
    rowCount: Number(result.row_count ?? rows.length),
    rowAffect: Number(result.row_affect ?? 0),
  };
}
