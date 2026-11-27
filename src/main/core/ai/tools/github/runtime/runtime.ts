import type {
  GithubConfig,
  GithubLogger,
  GithubToolkitOptions,
} from './contracts';
import { writeOverflowFile } from './overflow';

const defaultLogger: GithubLogger = {
  info(message) {
    console.info(message);
  },
  warn(message) {
    console.warn(message);
  },
};

interface GithubRuntime {
  config?: GithubToolkitOptions['config'];
  logger: GithubLogger;
  writeOverflow: NonNullable<GithubToolkitOptions['writeOverflow']>;
}

let runtime: GithubRuntime = {
  logger: defaultLogger,
  writeOverflow: writeOverflowFile,
};

export function configureGithubToolkit(options: GithubToolkitOptions = {}): void {
  runtime = {
    config: options.config,
    logger: options.logger ?? defaultLogger,
    writeOverflow: options.writeOverflow ?? writeOverflowFile,
  };
}

export function resetGithubRuntime(): void {
  runtime = {
    logger: defaultLogger,
    writeOverflow: writeOverflowFile,
  };
}

export function getRuntimeGithubConfig(): GithubConfig | undefined {
  const source = runtime.config;
  return typeof source === 'function' ? source() : source;
}

export function setGithubRuntimeConfig(
  config: GithubToolkitOptions['config']
): void {
  runtime = { ...runtime, config };
}

export function getGithubLogger(): GithubLogger {
  return runtime.logger;
}

export function writeGithubOverflow(
  label: string,
  content: string
): Promise<string> {
  return runtime.writeOverflow(label, content);
}
