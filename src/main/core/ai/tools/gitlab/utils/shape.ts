export {
  estimateTokens,
  pickKeywordLines,
  truncateByTokens,
} from '../../shared/tokens';

export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bgl[a-z]{2,8}-[A-Za-z0-9_-]{8,}/g, '[已脱敏的令牌]')
    .replace(/(PRIVATE-TOKEN\s*[:=]\s*)(\S+)/gi, '$1[已脱敏的令牌]')
    .replace(/([?&](?:private_token|access_token|token)=)([^&\s]+)/gi, '$1[已脱敏的令牌]');
}
