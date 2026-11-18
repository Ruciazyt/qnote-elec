
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
  reason?: string;
}

export interface UpdateEnvironment {
  packaged: boolean;
  portable: boolean;
  releasesUrl: string;
  platform: string;
  macBuiltinInstaller: boolean;
}
