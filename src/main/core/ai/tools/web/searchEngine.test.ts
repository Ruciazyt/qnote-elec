
import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  extractTitle,
  htmlToText,
  parseBaiduResults,
  parseBingResults,
} from './searchEngine';

const BING_HTML = `
<ul>
  <li class="b_algo">
    <h2><a href="https://www.electronjs.org/docs/latest" target="_blank">Electron 官方文档</a></h2>
    <div class="b_caption"><p>用 HTML、JavaScript 构建跨平台桌面应用。</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="https://runoob.com/electron/intro">Electron 简介</a></h2>
    <div class="b_caption"><p>Electron 是一个开源框架。</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="javascript:void(0)">广告位</a></h2>
    <div class="b_caption"><p>不该被收进来。</p></div>
  </li>
</ul>`;

const BAIDU_HTML = `
<div class="result c-container">
  <h3 class="t"><a href="http://www.baidu.com/link?url=abc123">Electron 实践 - 博客园</a></h3>
  <div class="c-abstract">Electron 桌面应用数据持久化实践。</div>
  <div class="extra" mu="https://www.cnblogs.com/demo/p/1.html"></div>
</div>
<div class="result c-container">
  <h3 class="t"><a href="https://www.baidu.com/link?url=def456">另一篇</a></h3>
  <div class="c-abstract">摘要内容。</div>
</div>`;

describe('parseBingResults', () => {
  it('提取标题、链接和摘要，并跳过非 http 链接', () => {
    const results = parseBingResults(BING_HTML, 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Electron 官方文档');
    expect(results[0].url).toBe('https://www.electronjs.org/docs/latest');
    expect(results[0].snippet).toContain('跨平台桌面应用');
    expect(results[1].url).toBe('https://runoob.com/electron/intro');
  });

  it('按 limit 截断', () => {
    expect(parseBingResults(BING_HTML, 1)).toHaveLength(1);
  });
});

describe('parseBaiduResults', () => {
  it('优先取 mu 里的真实地址', () => {
    const results = parseBaiduResults(BAIDU_HTML, 5);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://www.cnblogs.com/demo/p/1.html');
    expect(results[0].title).toBe('Electron 实践 - 博客园');
    expect(results[1].url).toBe('https://www.baidu.com/link?url=def456');
  });
});

describe('decodeEntities', () => {
  it('解码命名实体与数字实体', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
    expect(decodeEntities('1 天前&ensp;&#0183;&ensp;正文')).toBe('1 天前 · 正文');
    expect(decodeEntities('&lt;tag&gt;')).toBe('<tag>');
  });
});

describe('htmlToText', () => {
  it('去掉脚本和样式，只留正文', () => {
    const html = '<html><head><style>.a{color:red}</style><script>var x=1;</script></head><body><p>第一段</p><p>第二段</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('第一段');
    expect(text).toContain('第二段');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var x=1');
  });
});

describe('extractTitle', () => {
  it('取 title 标签内容', () => {
    expect(extractTitle('<html><head><title>  标题 &amp; 更多 </title></head></html>')).toBe('标题 & 更多');
  });
});
