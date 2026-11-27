import { log } from '../../system/log';
import { configureGithubToolkit } from './github/index';
import { createUserDataOverflowWriter } from './shared/qnoteOverflow';

export function configureQNoteGithubAdapter(): void {
  configureGithubToolkit({
    logger: {
      info: (message) => log.info(message),
      warn: (message) => log.warn(message),
    },
    writeOverflow: createUserDataOverflowWriter('github-overflow'),
  });
}
