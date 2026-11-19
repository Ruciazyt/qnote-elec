
import { nativeCall } from '../../../system/nativeModules';

export type SearchEngineId = 'bing' | 'baidu';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutcome {
  engine: SearchEngineId;
  results: WebSearchResult[];
  warning?: string;
}

interface NativeWeb {
  decodeEntities(input: string): string;
  stripTags(html: string): string;
  plainText(html: string): string;
  htmlToText(html: string): string;
  extractTitle(html: string): string;
  parseBingResults(html: string, limit: number): WebSearchResult[];
  parseBaiduResults(html: string, limit: number): WebSearchResult[];
}

const WRAPPER = 'web-rs.cjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', hellip: '…', middot: '·', mdash: '—', ndash: '–', laquo: '«',
  raquo: '»', ldquo: '"', rdquo: '"', lsquo: '‘', rsquo: '’', times: '×',
  divide: '÷', deg: '°', copy: '©', reg: '®', trade: '™', bull: '•',
  dagger: '†', permil: '‰', euro: '€', pound: '£', yen: '¥', cent: '¢',
  sect: '§', para: '¶', micro: 'µ', frac12: '½', frac14: '¼', frac34: '¾',
  szlig: 'ß', shy: '', zwnj: '', zwj: '', larr: '←', rarr: '→', uarr: '↑',
  darr: '↓', harr: '↔',
};

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function tsDecodeEntities(input: string): string {
  return input
    .replace(/&#(x[0-9a-fA-F]+|[0-9]+);/gi, (match, body: string) => {
      const hex = body.charAt(0).toLowerCase() === 'x';
      const code = hex ? parseInt(body.slice(1), 16) : parseInt(body, 10);
      return Number.isFinite(code) ? fromCodePoint(code) : match;
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]{0,30});/g, (match, body: string) => {
      const mapped = ENTITY_MAP[body];
      return mapped === undefined ? match : mapped;
    });
}

function tsStripTags(html: string): string {
  const segments = html.split('<');
  const kept: string[] = [segments[0] ?? ''];
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    const end = seg.indexOf('>');
    kept.push(end >= 0 ? seg.slice(end + 1) : '');
  }
  return kept.join(' ');
}

function tsPlainText(html: string): string {
  return tsDecodeEntities(tsStripTags(html))
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

function tsHtmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|ul|ol|tr|h[1-6]|blockquote|pre)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  const lines = tsDecodeEntities(tsStripTags(text))
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim());

  const out: string[] = [];
  let pendingBlank = false;
  for (const line of lines) {
    if (!line) {
      pendingBlank = out.length > 0;
      continue;
    }
    if (pendingBlank) out.push('');
    out.push(line);
    pendingBlank = false;
  }
  return out.join('\n');
}

function tsExtractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? tsPlainText(m[1]).slice(0, 200) : '';
}

function tsParseBingResults(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const url = tsDecodeEntities(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const desc = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    results.push({
      title: tsPlainText(link[2]).slice(0, 160),
      url,
      snippet: desc ? tsPlainText(desc[1]).slice(0, 400) : '',
    });
  }
  return results;
}

function tsParseBaiduResults(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = html.split(/<div[^>]*class="[^"]*c-container[^"]*"/).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const link = /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const real = /\bmu="([^"]+)"/.exec(block);
    const url = tsDecodeEntities(real ? real[1] : link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const body = block.replace(/<h3[\s\S]*?<\/h3>/i, ' ');
    results.push({
      title: tsPlainText(link[2]).slice(0, 160),
      url,
      snippet: tsPlainText(body).slice(0, 400),
    });
  }
  return results;
}

export function decodeEntities(input: string): string {
  return nativeCall<string, NativeWeb>(
    WRAPPER,
    'decodeEntities',
    () => tsDecodeEntities(input),
    (module) => module.decodeEntities(input)
  );
}

export function stripTags(html: string): string {
  return nativeCall<string, NativeWeb>(
    WRAPPER,
    'stripTags',
    () => tsStripTags(html),
    (module) => module.stripTags(html)
  );
}

export function plainText(html: string): string {
  return nativeCall<string, NativeWeb>(
    WRAPPER,
    'plainText',
    () => tsPlainText(html),
    (module) => module.plainText(html)
  );
}

export function htmlToText(html: string): string {
  return nativeCall<string, NativeWeb>(
    WRAPPER,
    'htmlToText',
    () => tsHtmlToText(html),
    (module) => module.htmlToText(html)
  );
}

export function extractTitle(html: string): string {
  return nativeCall<string, NativeWeb>(
    WRAPPER,
    'extractTitle',
    () => tsExtractTitle(html),
    (module) => module.extractTitle(html)
  );
}

export function parseBingResults(html: string, limit: number): WebSearchResult[] {
  return nativeCall<WebSearchResult[], NativeWeb>(
    WRAPPER,
    'parseBingResults',
    () => tsParseBingResults(html, limit),
    (module) => module.parseBingResults(html, limit)
  );
}

export function parseBaiduResults(html: string, limit: number): WebSearchResult[] {
  return nativeCall<WebSearchResult[], NativeWeb>(
    WRAPPER,
    'parseBaiduResults',
    () => tsParseBaiduResults(html, limit),
    (module) => module.parseBaiduResults(html, limit)
  );
}

export function buildSearchUrl(engine: SearchEngineId, query: string): string {
  const q = encodeURIComponent(query);
  if (engine === 'baidu') return `https://www.baidu.com/s?wd=${q}&rn=10`;
  return `https://www.bing.com/search?q=${q}&count=10`;
}

function charsetOf(contentType: string | null, head: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head.slice(0, 4096));
  if (fromMeta) return fromMeta[1].toLowerCase();
  return 'utf-8';
}

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ text: string; status: number; contentType: string }> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    const slice =
      buffer.byteLength > maxBytes ? buffer.slice(0, maxBytes) : buffer;
    const bytes = new Uint8Array(slice);
    const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 4096));
    const charset = charsetOf(res.headers.get('content-type'), head);
    let text: string;
    try {
      text = new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch {
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return { text, status: res.status, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

export async function runWebSearch(
  query: string,
  engine: SearchEngineId,
  limit: number
): Promise<WebSearchOutcome> {
  const order: SearchEngineId[] = engine === 'baidu' ? ['baidu', 'bing'] : ['bing', 'baidu'];
  const warnings: string[] = [];

  for (const id of order) {
    try {
      const { text } = await fetchText(buildSearchUrl(id, query));
      const results =
        id === 'bing' ? parseBingResults(text, limit) : parseBaiduResults(text, limit);
      if (results.length > 0) {
        return { engine: id, results, warning: warnings.join('；') || undefined };
      }
      warnings.push(`${id} 没解析到结果`);
    } catch (err) {
      warnings.push(`${id} 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { engine: order[0], results: [], warning: warnings.join('；') };
}
