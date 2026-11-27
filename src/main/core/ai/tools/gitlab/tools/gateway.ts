import { tool } from '../../tool';
import { getGitlabBotConfig } from '../../../gitlabBot/configStore';
import {
  buildWebhookUrl,
  maskWebhookSecret,
  GITLAB_WEBHOOK_DEFAULT_EVENTS,
} from '../../../gitlabBot/webhookTemplate';
import { strictObject } from '../schemas/input';

export const gitlabGatewayStatusTool = tool(
  async () => {
    const config = getGitlabBotConfig();
    const mode = config.signingToken
      ? 'signing'
      : config.secretToken
        ? 'plaintext'
        : 'none';
    return {
      enabled: config.enabled,
      mode,
      port: config.port,
      bind_address: config.bindAddress,
      webhook_url: buildWebhookUrl(config.port, config.bindAddress),
      relay_url: `http://127.0.0.1:${config.port}/gitlab/relay`,
      relay_ready: Boolean(config.relayToken),
      trigger_words: config.triggerWords,
      allowed_projects: config.allowedProjects,
      signing_token_hint: config.signingToken
        ? maskWebhookSecret(config.signingToken)
        : '',
      secret_token_hint: config.secretToken
        ? maskWebhookSecret(config.secretToken)
        : '',
      relay_token_hint: config.relayToken
        ? maskWebhookSecret(config.relayToken)
        : '',
      default_events: GITLAB_WEBHOOK_DEFAULT_EVENTS,
    };
  },
  {
    name: 'gitlab_gateway_status',
    description:
      '读取 QNote 内置 GitLab 网关的配置：是否启用、监听端口与地址、webhook 接收地址、relay 地址、触发词、允许的项目、当前密钥模式（signing / plaintext）。不返回密钥明文。',
    schema: strictObject({}),
  }
);
