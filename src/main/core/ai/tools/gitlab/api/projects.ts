import { gitlabRequest } from "./client";
import { gitlabEndpoints } from "./endpoints";
import type { GitlabProject } from "./types";

export async function resolveProjectId(project: string): Promise<{
  id: number;
  path: string;
  defaultBranch: string;
}> {
  const result = await gitlabRequest<GitlabProject>({
    method: "GET",
    path: gitlabEndpoints.projects() + "/" + encodeURIComponent(project),
    idempotent: true,
  });
  const data = result.data;
  if (!data?.id) {
    throw new Error("读不到项目 ID：项目 " + project + " 可能不存在");
  }
  return {
    id: data.id,
    path: data.path_with_namespace || project,
    defaultBranch: data.default_branch || "main",
  };
}
