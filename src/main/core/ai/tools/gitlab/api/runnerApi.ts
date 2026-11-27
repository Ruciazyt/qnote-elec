import { gitlabRequest } from "./client";
import { gitlabEndpoints } from "./endpoints";
import type { GitlabRunner, GitlabRunnerAuth } from "./types";

export async function listProjectRunners(project: string): Promise<GitlabRunner[]> {
  const result = await gitlabRequest<GitlabRunner[]>({
    method: "GET",
    path: gitlabEndpoints.runners(project),
    idempotent: true,
  });
  return Array.isArray(result.data) ? result.data : [];
}

export async function getRunner(runnerId: number): Promise<GitlabRunner | null> {
  const result = await gitlabRequest<GitlabRunner>({
    method: "GET",
    path: gitlabEndpoints.runner(runnerId),
    idempotent: true,
  });
  return result.data ?? null;
}

export async function updateRunner(
  runnerId: number,
  patch: Record<string, unknown>
): Promise<GitlabRunner> {
  const result = await gitlabRequest<GitlabRunner>({
    method: "PUT",
    path: gitlabEndpoints.runner(runnerId),
    body: patch,
  });
  return result.data;
}

export async function createProjectRunner(
  projectId: number,
  options: {
    description: string;
    tagList: string[];
    locked?: boolean;
    accessLevel?: string;
  }
): Promise<GitlabRunnerAuth> {
  const result = await gitlabRequest<GitlabRunnerAuth>({
    method: "POST",
    path: gitlabEndpoints.userRunners(),
    body: {
      runner_type: "project_type",
      project_id: projectId,
      description: options.description,
      tag_list: options.tagList,
      run_untagged: false,
      locked: options.locked ?? true,
      access_level: options.accessLevel ?? "not_protected",
    },
  });
  return result.data;
}

export async function resetRunnerAuthToken(
  runnerId: number
): Promise<GitlabRunnerAuth> {
  const result = await gitlabRequest<GitlabRunnerAuth>({
    method: "POST",
    path: gitlabEndpoints.runnerResetToken(runnerId),
  });
  return result.data;
}

export async function deleteRunner(runnerId: number): Promise<void> {
  await gitlabRequest({
    method: "DELETE",
    path: gitlabEndpoints.runner(runnerId),
  });
}
