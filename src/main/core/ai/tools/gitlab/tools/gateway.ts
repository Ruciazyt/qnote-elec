import { tool } from '../../tool';
import { getGitlabBotConfig } from '../../../gitlabBot/config/configStore';
import { strictObject } from '../schemas/input';

export const gitlabGatewayStatusTool = tool(
  async () => {
    const config = getGitlabBotConfig();
    return {
      enabled: config.enabled,
      relay_url: `http://127.0.0.1:${config.port}/gitlab/relay`,
      relay_ready: Boolean(config.relayToken),
      trigger_words: config.triggerWords,
      allowed_projects: config.allowedProjects,
    };
  },
  {
    name: 'gitlab_gateway_status',
    description:
      '读取 QNote GitLab Relay 状态、接入地址、触发词与项目白名单。',
    schema: strictObject({}),
  }
);
