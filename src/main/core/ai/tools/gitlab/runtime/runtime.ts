import type {
  GitlabConfig,
  GitlabLogger,
  GitlabToolkitOptions,
} from './contracts';
import { writeOverflowFile } from './overflow';

const defaultLogger: GitlabLogger = {
  info(message) {
    console.info(message);
  },
  warn(message) {
    console.warn(message);
  },
};

interface GitlabRuntime {
  config?: GitlabToolkitOptions['config'];
  logger: GitlabLogger;
  writeOverflow: NonNullable<GitlabToolkitOptions['writeOverflow']>;
}

let runtime: GitlabRuntime = {
  logger: defaultLogger,
  writeOverflow: writeOverflowFile,
};

export function configureGitlabToolkit(options: GitlabToolkitOptions = {}): void {
  runtime = {
    config: options.config ?? runtime.config,
    logger: options.logger ?? defaultLogger,
    writeOverflow: options.writeOverflow ?? writeOverflowFile,
  };
}

export function resetGitlabRuntime(): void {
  runtime = {
    logger: defaultLogger,
    writeOverflow: writeOverflowFile,
  };
}

export function getRuntimeGitlabConfig(): GitlabConfig | undefined {
  const source = runtime.config;
  return typeof source === 'function' ? source() : source;
}

export function setGitlabRuntimeConfig(
  config: GitlabToolkitOptions['config']
): void {
  runtime = { ...runtime, config };
}

export function getGitlabLogger(): GitlabLogger {
  return runtime.logger;
}

export function writeGitlabOverflow(
  label: string,
  content: string
): Promise<string> {
  return runtime.writeOverflow(label, content);
}
