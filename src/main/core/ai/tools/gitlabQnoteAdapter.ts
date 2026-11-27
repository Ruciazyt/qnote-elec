import { log } from '../../system/log';
import { configureGitlabToolkit } from './gitlab/index';
import { createUserDataOverflowWriter } from './shared/qnoteOverflow';

export function configureQNoteGitlabAdapter(): void {
  configureGitlabToolkit({
    logger: {
      info: (message) => log.info(message),
      warn: (message) => log.warn(message),
    },
    writeOverflow: createUserDataOverflowWriter('gitlab-overflow'),
  });
}
