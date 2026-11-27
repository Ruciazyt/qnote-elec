export {
  estimateTokens,
  pickKeywordLines,
  truncateByTokens,
} from '../../shared/tokens';

export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/gh[pousr]_[A-Za-z0-9_]{8,}/g, '[已脱敏的令牌]')
    .replace(/github_pat_[A-Za-z0-9_]{8,}/g, '[已脱敏的令牌]')
    .replace(/(Authorization\s*[:=]\s*)(Bearer\s+)?(\S+)/gi, '$1$2[已脱敏的令牌]')
    .replace(/([?&](?:access_token|token)=)([^&\s]+)/gi, '$1[已脱敏的令牌]');
}
