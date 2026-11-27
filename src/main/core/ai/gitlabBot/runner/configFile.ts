export interface RunnerConfigInfo {
  name: string;
  url: string;
  id: number;
  token: string;
  executor: string;
  shell: string;
}

function readString(text: string, key: string): string {
  const match = text.match(new RegExp("^\\s*" + key + "\\s*=\\s*\"([^\"]*)\"", "m"));
  return match ? match[1] : "";
}

function readNumber(text: string, key: string): number {
  const match = text.match(new RegExp("^\\s*" + key + "\\s*=\\s*(-?\\d+)", "m"));
  return match ? Number(match[1]) : 0;
}

export function parseRunnerConfigToml(text: string): RunnerConfigInfo | null {
  if (!text.trim()) return null;
  const token = readString(text, "token");
  if (!token) return null;
  return {
    name: readString(text, "name"),
    url: readString(text, "url"),
    id: readNumber(text, "id"),
    token,
    executor: readString(text, "executor"),
    shell: readString(text, "shell"),
  };
}

export function runnerConfigIsUsable(text: string): boolean {
  const info = parseRunnerConfigToml(text);
  return Boolean(info && info.token && info.url);
}
