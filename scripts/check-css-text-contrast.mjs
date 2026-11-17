
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPalettes, tokenColor, composite, contrast } from "./check-contrast.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const rendererRoot = path.join(repoRoot, "src", "renderer");

const TEXT_PROPS = new Set(["color", "-webkit-text-fill-color"]);

const HSL_VAR_RE = /^\s*hsl\(\s*var\(\s*--([a-z0-9-]+)\s*\)\s*(?:\/\s*([\d.]+)\s*)?\)\s*$/i;

const HSL_ANY_RE = /hsl\(\s*var\(\s*--([a-z0-9-]+)\s*\)\s*(?:\/\s*([\d.]+)\s*)?\)/gi;


export function parseCssRules(text) {
  const rules = [];
  const stack = [];
  let buf = "";
  let bufStart = 1;
  let line = 1;

  const commit = () => {
    const t = buf.trim();
    const top = stack[stack.length - 1];
    buf = "";
    if (!t || !top || top.kind !== "rule") return;
    const idx = t.indexOf(":");
    if (idx <= 0) return;
    top.decls.push({
      prop: t.slice(0, idx).trim().toLowerCase(),
      value: t.slice(idx + 1).trim(),
      line: bufStart,
    });
  };

  for (const raw of text.split(/\r?\n/)) {
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      if (ch === "{") {
        const sel = buf.trim();
        buf = "";
        if (/^@keyframes/i.test(sel)) {
          stack.push({ kind: "keyframes", selector: sel, context: [], decls: [] });
        } else if (sel.startsWith("@")) {
          stack.push({ kind: "at", selector: sel, context: [], decls: [] });
        } else {
          stack.push({
            kind: "rule",
            selector: sel,
            context: stack.filter((s) => s.kind === "at").map((s) => s.selector),
            decls: [],
          });
        }
        bufStart = line;
        continue;
      }

      if (ch === "}") {
        commit();
        const ctx = stack.pop();
        if (ctx && ctx.kind === "rule") rules.push(ctx);
        buf = "";
        bufStart = line;
        continue;
      }

      if (ch === ";") {
        commit();
        bufStart = line;
        continue;
      }

      if (!buf.trim() && ch.trim()) bufStart = line;
      buf += ch;
    }
    bufStart = line;
    line++;
  }

  return rules;
}


const BASE_NAMES = ["card", "background"];

export function hitSignature(file, selector, token, alpha) {
  const sel = selector
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${file} › ${sel} › ${token}@${alpha}`;
}

function measure(token, alpha, ownBases, themes, palettes) {
  const perTheme = {};

  for (const theme of themes) {
    const colors = palettes[theme];
    const fgRgb = colors.get(token);
    if (!fgRgb) {
      perTheme[theme] = null;
      continue;
    }

    const bases = [];
    for (const ob of ownBases) {
      const bgRgb = colors.get(ob.token);
      const card = colors.get("card") ?? colors.get("background");
      if (!bgRgb || !card) continue;
      bases.push({
        name: `自有底 ${ob.token}${ob.alpha !== 1 ? "/" + Math.round(ob.alpha * 100) : ""}`,
        color: composite(bgRgb, card, ob.alpha),
      });
    }
    if (!bases.length) {
      for (const name of BASE_NAMES) {
        const c = colors.get(name);
        if (c) bases.push({ name, color: c });
      }
    }
    if (!bases.length) {
      perTheme[theme] = null;
      continue;
    }

    const perBase = {};
    for (const b of bases) {
      perBase[b.name] = contrast(composite(fgRgb, b.color, alpha), b.color);
    }
    perTheme[theme] = { perBase, worst: Math.min(...Object.values(perBase)) };
  }

  const values = [perTheme.light?.worst, perTheme.dark?.worst].filter((v) => v !== undefined);
  if (!values.length) {
    return { perTheme, worst: null, aa: false, large: false, unknown: true };
  }
  const worst = Math.min(...values);

  return { perTheme, worst, aa: worst >= 4.5, large: worst >= 3, unknown: false };
}


export function scanCssTextColors(text, { file = "<memory>", palettes = buildPalettes() } = {}) {
  const rules = parseCssRules(text);
  const hits = [];

  for (const rule of rules) {
    const ownBases = [];
    for (const d of rule.decls) {
      if (d.prop !== "background" && d.prop !== "background-color") continue;
      if (!/url\(/i.test(d.value)) {
        for (const m of d.value.matchAll(HSL_ANY_RE)) {
          ownBases.push({
            token: m[1],
            alpha: m[2] !== undefined ? Number(m[2]) : 1,
          });
        }
      }
      break;
    }

    for (const d of rule.decls) {
      if (!TEXT_PROPS.has(d.prop)) continue;
      const m = HSL_VAR_RE.exec(d.value);
      if (!m) continue;
      const token = m[1];
      const alpha = m[2] !== undefined ? Number(m[2]) : 1;
      const themes = /\.dark\b/.test(rule.selector) ? ["dark"] : ["light", "dark"];
      const known = themes.some((t) => palettes[t].has(token));
      hits.push({
        file,
        line: d.line,
        selector: rule.selector,
        signature: hitSignature(file, rule.selector, token, alpha),
        context: rule.context,
        prop: d.prop,
        token,
        alpha,
        ownBases,
        skipped: !known,
        ...measure(token, alpha, ownBases, themes, palettes),
      });
    }
  }

  return hits;
}

export function cssFilesInRepo(root = rendererRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export function scanRepoCss({ root = rendererRoot, palettes = buildPalettes() } = {}) {
  const hits = [];
  for (const abs of cssFilesInRepo(root)) {
    const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
    const text = fs.readFileSync(abs, "utf8");
    hits.push(...scanCssTextColors(text, { file: rel, palettes }));
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}


const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const all = scanRepoCss();
  const hits = all.filter((h) => !h.skipped);
  const skipped = all.filter((h) => h.skipped);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(all, null, 2));
  } else {
    console.log(`CSS 文字色扫描 —— ${hits.length} 处（另有 ${skipped.length} 处 token 不在主题里，不判）`);
    console.log(
      "口径：WCAG 2.x；底取规则自有底（纯色 background / 渐变每个色标）或 --card/--background 更差者；文字线 4.5:1"
    );
    for (const h of hits) {
      const light = h.perTheme.light ? h.perTheme.light.worst.toFixed(2) : "-";
      const dark = h.perTheme.dark ? h.perTheme.dark.worst.toFixed(2) : "-";
      const verdict = h.aa ? "过AA" : h.large ? "仅大字" : "不过线";
      console.log(
        `  ${h.file}:${h.line}  ${h.prop}: hsl(var(--${h.token})${
          h.alpha !== 1 ? ` / ${h.alpha}` : ""
        })  light ${light} / dark ${dark}  ${verdict}  ← ${h.selector.replace(/\s+/g, " ").slice(0, 60)}`
      );
    }
    for (const h of skipped) {
      console.log(`  ${h.file}:${h.line}  ${h.prop}: hsl(var(--${h.token}))  ← token 不在主题里，跳过`);
    }
    const bad = hits.filter((h) => !h.aa);
    console.log(`\n不过 AA（4.5）：${bad.length} 处 / 共 ${hits.length} 处`);
  }
}
