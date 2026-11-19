import { createHash } from "node:crypto";
import {
  MCP_SERVER_SEGMENT_MAX_LENGTH,
  MCP_TOOL_NAME_MAX_LENGTH,
  normalizeMcpNameSegment,
  shortenMcpNameSegment,
} from "./toolName";

export interface McpNameCandidate {
  key: string;
  name: string;
}

interface ServerAssignment {
  key: string;
  raw: string;
  segment: string;
  tools: Map<string, string>;
}

export class McpNameRegistry {
  private servers = new Map<string, ServerAssignment>();

  assignServers(candidates: McpNameCandidate[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const candidate of candidates) {
      const existing = this.servers.get(candidate.key);
      if (existing) {
        result.set(candidate.key, existing.segment);
        continue;
      }
      const segment = this.allocateServerSegment(candidate);
      this.servers.set(candidate.key, {
        key: candidate.key,
        raw: candidate.name,
        segment,
        tools: new Map(),
      });
      result.set(candidate.key, segment);
    }
    return result;
  }

  assignTools(serverKey: string, rawNames: string[]): Map<string, string> {
    const server = this.servers.get(serverKey);
    if (!server) {
      throw new Error("MCP 服务器名称尚未分配");
    }
    const result = new Map<string, string>();
    for (const raw of rawNames) {
      const existing = server.tools.get(raw);
      if (existing) {
        result.set(raw, existing);
        continue;
      }
      const segment = this.allocateToolSegment(server, raw);
      server.tools.set(raw, segment);
      result.set(raw, segment);
    }
    return result;
  }

  private allocateServerSegment(candidate: McpNameCandidate): string {
    const preferred = shortenMcpNameSegment(
      normalizeMcpNameSegment(candidate.name, "server"),
      MCP_SERVER_SEGMENT_MAX_LENGTH,
      "server"
    );
    if (!this.isServerSegmentTaken(preferred, candidate.key)) {
      return preferred;
    }
    const suffix = shortHash(candidate.key);
    const withHash = shortenMcpNameSegment(
      `${preferred}_${suffix}`,
      MCP_SERVER_SEGMENT_MAX_LENGTH,
      "server"
    );
    if (!this.isServerSegmentTaken(withHash, candidate.key)) {
      return withHash;
    }
    for (let index = 2; index < 100; index += 1) {
      const candidate2 = shortenMcpNameSegment(
        `${preferred}_${index}`,
        MCP_SERVER_SEGMENT_MAX_LENGTH,
        "server"
      );
      if (!this.isServerSegmentTaken(candidate2, candidate.key)) {
        return candidate2;
      }
    }
    return withHash;
  }

  private allocateToolSegment(server: ServerAssignment, raw: string): string {
    const max = MCP_TOOL_NAME_MAX_LENGTH - 7 - server.segment.length;
    const preferred = shortenMcpNameSegment(
      normalizeMcpNameSegment(raw, "tool"),
      max,
      "tool"
    );
    if (!this.isToolSegmentTaken(server, preferred)) return preferred;
    const suffix = shortHash(`${server.key}:${raw}`);
    const withHash = shortenMcpNameSegment(`${preferred}_${suffix}`, max, "tool");
    if (!this.isToolSegmentTaken(server, withHash)) return withHash;
    for (let index = 2; index < 100; index += 1) {
      const candidate = shortenMcpNameSegment(
        `${preferred}_${index}`,
        max,
        "tool"
      );
      if (!this.isToolSegmentTaken(server, candidate)) return candidate;
    }
    return withHash;
  }

  private isToolSegmentTaken(server: ServerAssignment, segment: string): boolean {
    for (const value of server.tools.values()) {
      if (value === segment) return true;
    }
    return false;
  }

  private isServerSegmentTaken(segment: string, key: string): boolean {
    for (const entry of this.servers.values()) {
      if (entry.key !== key && entry.segment === segment) return true;
    }
    return false;
  }
}

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 6);
}
