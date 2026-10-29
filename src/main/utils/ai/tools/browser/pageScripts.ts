/**
 * 注入到网页上下文的脚本构造器
 *
 * 核心思路（借鉴 browser-use 的 `state` 模式）：
 *   不让模型写 CSS 选择器，而是把页面上「可交互元素」编号后交给模型，
 *   模型只回一个数字。这样模型不用理解 DOM 结构，也不会写出脆弱/无效的选择器。
 *
 * 元素抽取的字段模型与启发式对齐了腾讯 BrowserSkill 的 `packages/vom`（page observation），
 * 但完全走纯 `executeJavaScript`，不接 CDP / AX 树。
 *
 * 为什么不接 CDP：CDP 要独占调试通道，而侧边栏有「打开开发者工具」按钮，
 * 两者会互相踢掉对方（后开的赢），表现为用户点开 DevTools 后 AI 的浏览器操作随机失效。
 * AX 树同理要挂调试通道。为了让 AI 在用户开着 DevTools 时也能工作，放弃 CDP 是明确取舍。
 * 代价是拿不到跨源 iframe、无障碍树和合成层信息 —— 这些在 notes 里如实降级说明。
 * 借鉴并落地的部分：
 *   - 穿越 open Shadow DOM 与同源 iframe（vom 同样按 root 分组输出）
 *   - 字段模型：nearbyText / inputState / sensitive / inert / checked=mixed
 *   - 浮层与遮挡检测（vom 的 BlockingLayer：kind + coverage）
 *   - 可见性优先用 `checkVisibility()`，rect 只作双保险
 *   - maxTokens 预算而非单纯元素数上限（vom 的 VomOptions.maxTokens）
 *
 * 关键实现约束：
 *   1. 寻址主用内存引用表 `window.__qnoteRefs[index] = { el, doc, win }`：
 *      `document.querySelector` 穿不透 shadow root 和 iframe，而跨 document 也没有全局选择器。
 *      `data-qnote-ref="N"` 只作为顶层 DOM 兜底（页面局部重渲染后仍可反查）。
 *   2. 引用表带一次性口令：页面若自己伪造 `window.__qnoteRefs` 也无法骗过 click / fill。
 *   3. 写 input/textarea 必须走**原型链上的原生 setter**：
 *      `el.value = x` 走的是元素自身属性，多数 React/Vue 站点监听不到，不会触发更新。
 *      iframe 里的元素要用它自己 realm 的 `HTMLInputElement.prototype`，跨 realm 取到的是顶层原型。
 *   4. 模型给的文本一律 JSON.stringify 后再拼进脚本，杜绝脚本注入。
 *   5. Shadow DOM 只支持 open 模式（closed 模式浏览器不允许外部读取，这是硬限制）。
 */

import { REF_SECRET } from './refSecret';

/** 可交互元素选择器全集 */
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[onclick]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="textbox"]',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 元素编号上限 —— click / fill 的入参校验与快照硬上限共用同一个值 */
export const MAX_REF_INDEX = 399;

export interface SnapshotElement {
  index: number;
  tag: string;
  role: string;
  type?: string;
  label: string;
  value?: string;
  href?: string;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  /** 文本类输入框是否有内容 —— 决定模型要不要先 fill 再提交 */
  inputState?: 'empty' | 'filled';
  /** 密码 / 验证码 / 证件号等敏感字段，模型应避免读取或回显 */
  sensitive?: boolean;
  /** 落在 inert 子树里，浏览器不会派发交互 */
  inert?: boolean;
  /** 元素自身的名字太弱时，补一句上下文文本（仅表单控件或弱命名元素才有） */
  nearbyText?: string;
  /** 位于 shadow root 内 */
  shadow?: boolean;
  /** 所在的同源 iframe 路径，如 "1" 或 "1>2" */
  frame?: string;
  /** 挡住它的元素描述；被遮挡时直接 click 不会命中用户可见的那一层 */
  occludedBy?: string;
}

export interface SnapshotModal {
  kind: 'mask' | 'modal' | 'panel';
  coverage: number;
  label: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
  text: string;
  truncated: boolean;
  /** 页面上命中的可交互元素总数（可能大于 elements.length） */
  totalInteractive: number;
  /** 本次快照粗估占用的 token 数 */
  estTokens: number;
  /** 检测到的高层浮层（遮罩 / 弹窗） */
  modal: SnapshotModal | null;
  /** 降级与提醒信息：跨源 iframe 不可达、遮挡检测跳过、元素截断等 */
  notes: string[];
}

export interface SnapshotOptions {
  maxTokens: number;
  maxElements: number;
  maxDepth: number;
}

/** 判定敏感字段的关键词 */
const SENSITIVE_RE =
  /pass(word)?|pwd|密码|口令|token|secret|cvv|cvc|card(number|no)?|信用卡|银行卡|身份证|ssn|otp|验证码|手机号|phone|mobile|email|邮箱|账号|user(name)?/i;

/**
 * click / fill 共用的引用表解析器
 *
 * 注意：这段代码会被拼进注入脚本，内部不允许出现反引号。
 */
const REF_RESOLVER = `
  function resolveRef(idx, secret) {
    var tbl = window.__qnoteRefs;
    if (tbl) {
      var rec = tbl[idx];
      if (rec && rec.secret === secret && rec.el) return rec;
    }
    // 兜底：顶层 DOM 上的 data-qnote-ref
    // （shadow / iframe 里的元素这条路走不到，但顶层元素重渲染后仍能靠属性找回）
    try {
      var el = document.querySelector('[data-qnote-ref="' + idx + '"]');
      if (el) return { el: el, doc: el.ownerDocument, win: el.ownerDocument.defaultView, secret: secret };
    } catch (e) {}
    return null;
  }`;

/**
 * 快照脚本：枚举可见的可交互元素并建立引用表
 *
 * @param opts maxTokens 上下文预算（主）/ maxElements 硬上限（兜底）/ maxDepth shadow+iframe 递归深度
 */
export function buildSnapshotScript(opts: SnapshotOptions): string {
  const cfg = JSON.stringify(opts);
  const sel = JSON.stringify(INTERACTIVE_SELECTOR);
  const secret = JSON.stringify(REF_SECRET);
  const sensitiveRe = SENSITIVE_RE.source;

  return `(() => {
  var CFG = ${cfg};
  var SEL = ${sel};
  var SECRET = ${secret};
  var SENSITIVE_RE = new RegExp(${JSON.stringify(sensitiveRe)}, 'i');
  var AUTOCOMPLETE_RE = /password|cc-|cc-number|one-time-code/;

  var TOPWIN = window;
  var TOPDOC = document;
  var MAX_LABEL = 60;
  var MAX_NEARBY = 80;

  // ---- 基础工具 ---------------------------------------------------------
  function flat(s) { return (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim(); }
  function cut(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function textOf(n) { return flat(n ? (n.innerText !== undefined ? n.innerText : n.textContent) : ''); }

  // 粗估 token：CJK 字符按 1.6 个宽字符计，其余按 1 计，再除以约 3.2 字符/token
  function estTokens(s) {
    if (!s) return 0;
    var cjk = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0x4e00 && c <= 0x9fff) cjk++;
    }
    return (s.length - cjk + cjk * 1.6) / 3.2;
  }

  // ---- 可见性 ------------------------------------------------------------
  // 优先 checkVisibility（覆盖 display/visibility/opacity/content-visibility 四种情况），
  // getComputedStyle + rect 只作双保险，老版本 Chromium 上 checkVisibility 可能不存在。
  function isVisible(el, win) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('hidden')) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    try {
      if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } catch (e) {}
    var cs = win.getComputedStyle(el);
    if (!cs) return false;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (cs.display === 'none') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    return true;
  }

  // 跨 shadow 边界的 inert 判定：Element.closest 不穿透 shadow root，要顺着 host 往上爬
  function isInert(el) {
    var n = el;
    var guard = 0;
    while (n && n.nodeType === 1 && guard < 64) {
      guard++;
      if (n.hasAttribute && n.hasAttribute('inert')) return true;
      var root = n.getRootNode ? n.getRootNode() : null;
      n = root && root.host ? root.host : n.parentElement;
    }
    return false;
  }

  function roleOf(el) {
    var r = el.getAttribute('role');
    if (r) return r;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'option') return 'option';
    return '';
  }

  // label 取值优先级：无障碍名 > placeholder > 关联 label > 可见文本 > alt/title/name/id
  function labelOf(el) {
    var v;
    v = el.getAttribute('aria-label'); if (v && v.trim()) return cut(flat(v), MAX_LABEL);
    v = el.getAttribute('placeholder'); if (v && v.trim()) return cut(flat(v), MAX_LABEL);
    if (el.labels && el.labels.length) {
      var parts = [];
      for (var j = 0; j < el.labels.length; j++) parts.push(textOf(el.labels[j]));
      var joined = flat(parts.join(' '));
      if (joined) return cut(joined, MAX_LABEL);
    }
    v = textOf(el); if (v) return cut(v, MAX_LABEL);
    v = el.getAttribute('alt'); if (v && v.trim()) return cut(flat(v), MAX_LABEL);
    v = el.getAttribute('title'); if (v && v.trim()) return cut(flat(v), MAX_LABEL);
    v = el.getAttribute('name'); if (v && v.trim()) return cut(flat(v), MAX_LABEL);
    if (el.id) return cut(el.id, MAX_LABEL);
    return el.tagName.toLowerCase();
  }

  // 上下文文本：只在「名字太弱」时才值得付这个 token
  // 典型场景是搜索框、图标按钮这种自身没有可见文本的元素。
  function nearbyTextOf(el) {
    var tag = el.tagName.toLowerCase();
    var isForm = tag === 'input' || tag === 'textarea' || tag === 'select';
    var named = flat(el.getAttribute('aria-label')) || flat(el.getAttribute('placeholder')) ||
      flat(el.getAttribute('title')) || (el.labels && el.labels.length);
    if (!isForm && !named) return '';
    var p = el.parentElement;
    if (!p) return '';
    var sibs = p.children;
    var idx = -1;
    for (var i = 0; i < sibs.length; i++) { if (sibs[i] === el) { idx = i; break; } }
    var seen = [];
    for (var a = idx - 1; a >= 0 && seen.length < 3; a--) seen.push(textOf(sibs[a]));
    for (var b = idx + 1; b < sibs.length && seen.length < 3; b++) seen.push(textOf(sibs[b]));
    if (!seen.length) seen.push(textOf(p));
    var out = flat(seen.join(' '));
    if (!out || out === textOf(el)) return '';
    return cut(out, MAX_NEARBY);
  }

  function isSensitive(el, type) {
    if (type === 'password') return true;
    var ac = el.getAttribute('autocomplete') || '';
    if (AUTOCOMPLETE_RE.test(ac.toLowerCase())) return true;
    var hay = [
      el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('placeholder'),
      el.getAttribute('aria-label'), el.getAttribute('title')
    ].join(' ');
    return SENSITIVE_RE.test(hay);
  }

  // ---- 遮挡检测 ----------------------------------------------------------
  // 从顶层坐标出发逐层穿透 shadow root 和 iframe，直到找到最深命中的元素
  function composedHit(px, py) {
    var root = TOPDOC;
    var x = px, y = py;
    var el = null;
    for (var guard = 0; guard < 12; guard++) {
      var d = null;
      try { d = root.elementFromPoint(x, y); } catch (e) { return null; }
      if (!d) return null;
      el = d;
      if (d.shadowRoot) {
        var inner = null;
        try { inner = d.shadowRoot.elementFromPoint(x, y); } catch (e) { inner = null; }
        if (inner && inner !== d) { root = d.shadowRoot; continue; }
      }
      if (d.tagName === 'IFRAME' || d.tagName === 'FRAME') {
        var cd = null;
        try { cd = d.contentDocument; } catch (e) { cd = null; }
        if (cd) {
          var lr = d.getBoundingClientRect();
          x -= lr.left; y -= lr.top;
          root = cd;
          continue;
        }
      }
      break;
    }
    return el;
  }

  function describeNode(n) {
    var win = n.ownerDocument ? n.ownerDocument.defaultView : TOPWIN;
    var cs = null;
    try { cs = win.getComputedStyle(n); } catch (e) { cs = null; }
    var t = (n.tagName || 'node').toLowerCase();
    var s = t;
    if (n.id) s += '#' + n.id;
    if (typeof n.className === 'string' && n.className.trim()) {
      s += '.' + flat(n.className).split(' ').slice(0, 2).join('.');
    }
    var role = n.getAttribute('role');
    if (role) s += '[role=' + role + ']';
    var lb = n.getAttribute('aria-label') || n.getAttribute('title');
    if (lb && lb.trim()) s += ' "' + cut(flat(lb), 20) + '"';
    if (cs && cs.zIndex && cs.zIndex !== 'auto') s += ' z=' + cs.zIndex;
    return s;
  }

  function occludedBy(rec) {
    var vw = TOPWIN.innerWidth, vh = TOPWIN.innerHeight;
    var r = rec.rect;
    var l = r.left + rec.offX, t = r.top + rec.offY;
    if (l + r.width < 0 || t + r.height < 0 || l > vw || t > vh) return '';
    var x = Math.min(Math.max(l + r.width / 2, 1), vw - 1);
    var y = Math.min(Math.max(t + r.height / 2, 1), vh - 1);
    var hit = composedHit(x, y);
    if (!hit) return '(视口内无命中，通常是被透明层盖住)';
    if (hit === rec.el || (rec.el.contains && rec.el.contains(hit))) return '';
    var n = hit;
    while (n && n.nodeType === 1) {
      var cs = null;
      try { cs = n.ownerDocument.defaultView.getComputedStyle(n); } catch (e) { cs = null; }
      if (cs && (cs.position === 'fixed' || cs.position === 'sticky' || cs.position === 'absolute')) {
        var z = parseInt(cs.zIndex, 10);
        if (!isNaN(z) && z >= 1) return describeNode(n);
      }
      n = n.parentElement;
    }
    return describeNode(hit);
  }

  // 整页浮层扫描：找覆盖面积大且 z-index 抬起来的遮罩/弹窗
  function findModalLayer() {
    var vw = TOPWIN.innerWidth, vh = TOPWIN.innerHeight;
    if (!vw || !vh) return { modal: null, skipped: false };
    var all;
    try { all = TOPDOC.querySelectorAll('body *'); } catch (e) { return { modal: null, skipped: false }; }
    if (all.length > 6000) return { modal: null, skipped: true };
    var area = vw * vh;
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      var cs = null;
      try { cs = TOPWIN.getComputedStyle(n); } catch (e) { continue; }
      if (!cs) continue;
      var pos = cs.position;
      if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') continue;
      var z = parseInt(cs.zIndex, 10);
      if (isNaN(z) || z < 1) continue;
      var r = n.getBoundingClientRect();
      if (r.width < vw * 0.5 || r.height < vh * 0.15) continue;
      var w = Math.min(r.right, vw) - Math.max(r.left, 0);
      var h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      var cov = (w * h) / area;
      if (cov <= 0.02) continue;
      if (!best || z > best.z || (z === best.z && cov > best.cov)) best = { z: z, cov: cov, node: n };
    }
    if (!best) return { modal: null, skipped: false };
    var kind = best.cov > 0.75 ? 'mask' : best.cov > 0.2 ? 'modal' : 'panel';
    return { modal: { kind: kind, coverage: Math.round(best.cov * 100) / 100, label: describeNode(best.node) }, skipped: false };
  }

  // ---- 采集 --------------------------------------------------------------
  var prev = TOPWIN.__qnoteRefs;
  if (prev) {
    for (var pk in prev) {
      try {
        var pr = prev[pk];
        if (pr && pr.el && pr.el.removeAttribute) pr.el.removeAttribute('data-qnote-ref');
      } catch (e) {}
    }
  }

  var refs = {};
  var elements = [];
  var notes = [];
  var total = 0;
  var spent = 0;
  var truncated = false;
  var stop = false;
  var crossOriginFrames = 0;
  var frameCount = 0;
  var frameSeq = 0;
  var shadowCount = 0;
  var depthHit = 0;
  var occludedCount = 0;

  function buildItem(el, doc, win, offX, offY, inShadow, framePath) {
    var tag = el.tagName.toLowerCase();
    var item = { index: elements.length, tag: tag, role: roleOf(el), label: labelOf(el) };
    if (inShadow) item.shadow = true;
    if (framePath) item.frame = framePath;

    if (tag === 'input') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      item.type = t;
      if (t === 'password') item.value = '***';
      else if (t !== 'file') item.value = cut(flat(el.value), MAX_LABEL);
      if (t !== 'hidden' && t !== 'submit' && t !== 'button' && t !== 'reset' && t !== 'image' && t !== 'file') {
        item.inputState = flat(el.value) ? 'filled' : 'empty';
      }
    } else if (tag === 'textarea') {
      item.value = cut(flat(el.value), MAX_LABEL);
      item.inputState = flat(el.value) ? 'filled' : 'empty';
    } else if (tag === 'select') {
      item.value = cut(textOf(el.selectedOptions && el.selectedOptions[0]), MAX_LABEL);
    }

    if (tag === 'a' && el.getAttribute('href')) item.href = cut(el.getAttribute('href'), 120);

    var ac = el.getAttribute('aria-checked');
    var isCheckable = item.role === 'checkbox' || item.role === 'radio' ||
      item.type === 'checkbox' || item.type === 'radio' || el.tagName === 'OPTION';
    if (isCheckable) {
      if (ac === 'mixed' || ac === 'true' || ac === 'false') item.checked = ac !== 'false';
      else if (typeof el.checked === 'boolean') item.checked = el.checked;
      else item.checked = false;
    }

    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (isInert(el)) item.inert = true;
    if (isSensitive(el, item.type)) item.sensitive = true;

    var near = nearbyTextOf(el);
    if (near) item.nearbyText = near;

    var r = el.getBoundingClientRect();
    refs[item.index] = {
      el: el, doc: doc, win: win, secret: SECRET, offX: offX, offY: offY,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
    return item;
  }

  function scan(root, doc, win, depth, inShadow, framePath, offX, offY) {
    if (stop) return;
    if (depth > CFG.maxDepth) { depthHit++; return; }

    var list;
    try { list = root.querySelectorAll(SEL); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      if (stop) return;
      var el = list[i];
      total++;
      if (elements.length >= CFG.maxElements) { truncated = true; stop = true; return; }
      if (!isVisible(el, win)) continue;
      var item = buildItem(el, doc, win, offX, offY, inShadow, framePath);
      var cost = estTokens(JSON.stringify(item));
      if (spent + cost > CFG.maxTokens) { truncated = true; stop = true; return; }
      spent += cost;
      el.setAttribute('data-qnote-ref', String(item.index));
      elements.push(item);
    }

    // 深层结构：open shadow root + 同源 iframe
    if (depth >= CFG.maxDepth) return;
    var all;
    try { all = root.querySelectorAll('*'); } catch (e) { return; }
    for (var k = 0; k < all.length; k++) {
      if (stop) return;
      var node = all[k];
      if (node.shadowRoot) {
        shadowCount++;
        scan(node.shadowRoot, doc, win, depth + 1, true, framePath, offX, offY);
      }
      if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
        var cd = null;
        try { cd = node.contentDocument; } catch (e) { cd = null; }
        var cwin = cd ? cd.defaultView : null;
        if (!cd || !cwin) { crossOriginFrames++; continue; }
        frameCount++;
        var fid = ++frameSeq;
        var lr = node.getBoundingClientRect();
        scan(cd, cd, cwin, depth + 1, inShadow, (framePath ? framePath + '>' : '') + fid,
          offX + lr.left, offY + lr.top);
      }
    }
  }

  scan(TOPDOC, TOPDOC, TOPWIN, 0, false, '', 0, 0);
  TOPWIN.__qnoteRefs = refs;
  TOPWIN.__qnoteRefStamp = Date.now();

  // 逐元素遮挡检测：元素数已被预算压到上限，这里是 O(元素数) 次命中测试
  for (var oi = 0; oi < elements.length; oi++) {
    var by = occludedBy(refs[elements[oi].index]);
    if (by) { elements[oi].occludedBy = by; occludedCount++; }
  }

  var found = findModalLayer();
  var modal = found.modal;
  if (found.skipped) notes.push('页面节点超过 6000 个，已跳过整页浮层扫描；遮挡标注仍然有效。');
  if (modal) {
    var kindText = modal.kind === 'mask' ? '遮罩层' : modal.kind === 'modal' ? '弹窗' : '浮层面板';
    notes.push('检测到' + kindText + '：' + modal.label + '，覆盖视口 ' + Math.round(modal.coverage * 100) +
      '%。被它挡住的元素已标注【被遮挡】，通常要先关掉这个浮层。');
  }
  if (shadowCount > 0) notes.push('已穿透 ' + shadowCount + ' 个 open Shadow DOM 根（closed 模式浏览器不允许读取，无法穿透）。');
  if (frameCount > 0) notes.push('已遍历 ' + frameCount + ' 个同源 iframe，元素行会标注 (iframe#n)。');
  if (crossOriginFrames > 0) {
    notes.push('有 ' + crossOriginFrames + ' 个跨源 iframe 读不到内容（浏览器同源策略限制），它们里面的元素不在列表里；若目标在跨源 iframe 内，请改用页面自身的搜索或导航。');
  }
  if (depthHit > 0) notes.push('有 ' + depthHit + ' 处嵌套超过 maxDepth=' + CFG.maxDepth + '，未继续深入。');
  if (occludedCount > 0) notes.push(occludedCount + ' 个元素被浮层挡住，点击它们不会命中用户可见的那一层。');
  if (truncated) {
    notes.push('元素过多，已按 ' + CFG.maxTokens + ' token 预算截断：共命中 ' + total + ' 个，只保留 ' +
      elements.length + ' 个。可调大 maxTokens，或先滚动到目标区域再取快照。');
  }

  var body = TOPDOC.body;
  return {
    url: TOPWIN.location.href,
    title: TOPDOC.title,
    elements: elements,
    text: body ? cut(flat(body.innerText), 1200) : '',
    truncated: truncated,
    totalInteractive: total,
    estTokens: Math.round(spent),
    modal: modal,
    notes: notes
  };
})()`;
}

/** 点击脚本：按编号找到元素并派发完整指针事件序列 */
export function buildClickScript(index: number): string {
  const secret = JSON.stringify(REF_SECRET);
  return `(() => {
  var idx = ${index};
  var SECRET = ${secret};
${REF_RESOLVER}
  var rec = resolveRef(idx, SECRET);
  if (!rec) {
    return { ok: false, error: '元素索引 ' + idx + ' 已失效（页面可能已跳转或重新渲染），请重新调用 browser_get_snapshot 获取最新索引' };
  }
  var el = rec.el, doc = rec.doc, win = rec.win;
  var tag = el.tagName.toLowerCase();
  var role = el.getAttribute('role') || '';
  var type = (el.getAttribute('type') || '').toLowerCase();

  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  try { if (el.focus) el.focus({ preventScroll: true }); } catch (e) {}

  // 命中检测：告诉调用方「用户其实点不到这里」，但仍然派发事件
  // （dispatchEvent 不做命中测试，直接打到目标元素上，模型要的效果仍然成立）
  var notice = '';
  try {
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var hit = doc.elementFromPoint(cx, cy);
    if (!hit || (hit !== el && !el.contains(hit))) {
      notice = '目标元素当前被其它内容覆盖（用户用鼠标点不到），事件已直接派发到它身上。';
    }
  } catch (e) {}

  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
    return { ok: true, tag: tag, role: role, notice: '目标元素处于禁用状态，这次点击没有任何效果。请换一个可用的元素。' };
  }

  // 复选/单选：合成点击不会像真实点击那样翻转勾选状态，需要手动补
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    try { el.checked = type === 'radio' ? true : !el.checked; } catch (e) {}
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    return { ok: true, tag: tag, role: role, checked: !!el.checked, notice: notice };
  }

  var r2 = el.getBoundingClientRect();
  var x = r2.left + r2.width / 2;
  var y = r2.top + r2.height / 2;
  var base = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, button: 0 };
  var seq = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  for (var i = 0; i < seq.length; i++) {
    var name = seq[i];
    var Ctor = null;
    try {
      Ctor = (name.indexOf('pointer') === 0 && win.PointerEvent) ? win.PointerEvent : win.MouseEvent;
      el.dispatchEvent(new Ctor(name, base));
    } catch (e) {
      el.dispatchEvent(new win.MouseEvent(name, base));
    }
  }
  return { ok: true, tag: tag, role: role, label: el.getAttribute('aria-label') || '', notice: notice };
})()`;
}

/** 输入脚本：按编号找到输入框并写入文本（走原生 setter + input/change 事件） */
export function buildFillScript(index: number, text: string): string {
  // 唯一一处外部输入进入脚本的地方 —— 必须 JSON.stringify
  const safeText = JSON.stringify(text);
  const secret = JSON.stringify(REF_SECRET);

  return `(() => {
  var idx = ${index};
  var val = ${safeText};
  var SECRET = ${secret};
${REF_RESOLVER}
  function flatStr(s) { return (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim(); }
  function flatText(node) { return flatStr(node ? (node.innerText !== undefined ? node.innerText : node.textContent) : ''); }

  var rec = resolveRef(idx, SECRET);
  if (!rec) {
    return { ok: false, error: '元素索引 ' + idx + ' 已失效（页面可能已跳转或重新渲染），请重新调用 browser_get_snapshot 获取最新索引' };
  }
  var el = rec.el, doc = rec.doc, win = rec.win;

  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  try { if (el.focus) el.focus({ preventScroll: true }); } catch (e) {}

  var tag = el.tagName.toLowerCase();
  if (el.hasAttribute('disabled') || el.hasAttribute('readonly') || el.getAttribute('aria-disabled') === 'true') {
    return { ok: false, code: 'NOT_EDITABLE', error: '元素 ' + idx + ' 当前不可编辑（disabled / readonly），无法写入文本。' };
  }

  // 富文本：必须用元素自己 realm 的 document.excCommand
  if (el.isContentEditable === true) {
    el.textContent = '';
    var inserted = false;
    try { inserted = doc.execCommand('insertText', false, val); } catch (e) { inserted = false; }
    // execCommand 对富文本编辑器有效，但对普通 contenteditable 常无反应，回退到直接写 textContent
    if (!inserted || flatText(el) !== flatStr(val)) {
      el.textContent = val;
      try {
        el.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
      } catch (e) { el.dispatchEvent(new win.Event('input', { bubbles: true })); }
    }
    return { ok: true, tag: tag, contenteditable: true, value: flatText(el).slice(0, 120) };
  }

  // 下拉框：写 value 只会静默失败，必须切 selectedIndex
  if (tag === 'select') {
    var opts = el.options;
    var picked = -1;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value === val || flatText(opts[i]) === flatStr(val)) { picked = i; break; }
    }
    if (picked < 0) {
      var want = flatStr(val);
      for (var j = 0; j < opts.length; j++) {
        if (flatText(opts[j]).indexOf(want) >= 0 || want.indexOf(flatText(opts[j])) >= 0) { picked = j; break; }
      }
    }
    if (picked < 0) {
      var names = [];
      for (var m = 0; m < opts.length && m < 20; m++) names.push(flatText(opts[m]));
      return { ok: false, code: 'NO_SUCH_OPTION', error: '下拉框里没有叫「' + val + '」的选项。可选值：' + names.join(' / ') };
    }
    el.selectedIndex = picked;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    return { ok: true, tag: tag, value: flatText(el.selectedOptions && el.selectedOptions[0]).slice(0, 120) };
  }

  // 原型链上的原生 setter —— 必须是元素自己 realm 的原型，
  // 跨 realm 拿到的 HTMLInputElement.prototype 描述符对 iframe 元素不生效
  var proto = null;
  try {
    proto = tag === 'textarea' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  } catch (e) { proto = null; }
  if (!proto) proto = el.constructor ? el.constructor.prototype : null;
  var desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
  if (desc && desc.set) desc.set.call(el, val); else el.value = val;

  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));

  return { ok: true, tag: tag, value: flatStr(el.value).slice(0, 120) };
})()`;
}
