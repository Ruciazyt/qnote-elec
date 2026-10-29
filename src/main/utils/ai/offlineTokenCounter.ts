/**
 * 把 token 计数改成纯本地估算，杜绝联网下载 tiktoken 词表。
 *
 * ## 要解决的卡顿
 *
 * `@langchain/openai` 在**流式响应聚合并之后**，会无条件调用
 * `_getEstimatedTokenCountFromPrompt()` 和 `_getNumTokensFromGenerations()`
 * 去填 `usage_metadata`（dist/chat_models/completions.cjs 里那段没有条件判断）。
 * 这两个方法最终都落到 `@langchain/core` 的 `BaseLanguageModel.getNumTokens()`，
 * 其实现是：
 *
 *     if (!this._encoding) {
 *       this._encoding = await encodingForModel(getModelNameForTiktoken(this.modelName) || "gpt2");
 *     }
 *
 * `encodingForModel` 会去 `https://tiktoken.pages.dev/js/gpt2.json` 下载 BPE 词表。
 * 国内连不上，每次 connect timeout 约 10.6 秒，而且一条消息里会触发多次。
 *
 * 实测（2026-10-16，validateApiKey，provider=openai）：
 *   POST https://api.minimax.cn/v1/chat/completions → HTTP 200，用时 926ms
 *   随后反复拉 tiktoken.pages.dev/js/gpt2.json，累计 343 秒才返回
 *   同样条件下 claude 分支只要 1.3 秒 —— 它不走这段统计
 *
 * 表现就是设置页「验证」按钮一直转圈，看起来像"网络不通"，其实请求早就成功了。
 *
 * ## 为什么改 encodingForModel，而不是覆写 getNumTokens
 *
 * - 在实例上覆写 `getNumTokens` **拦不住这条路径**。实测真正被调用的是
 *   `@langchain/openai` 内部持有的那个 `ChatOpenAICompletions` 实例，
 *   它身上没有我们设在 `ChatOpenAI` 实例上的任何属性
 *   （探针输出：`自有 getNumTokens=false`、`this._encoding=无`）。
 * - 覆写 `BaseLanguageModel.prototype.getNumTokens` 能解决，但会把 LangChain
 *   自己那套「tokensPerMessage=3、函数调用加减、末尾 +3」的估算逻辑一起顶掉。
 * - 只把 `encodingForModel` 换成本地实现，LangChain 的逻辑原样保留：
 *   `getNumTokens` 里 `this._encoding = await encodingForModel(...)` 拿到的是我们的
 *   假 encoding，接着照常走 `this._encoding.encode(text).length`，
 *   整条链路不碰网络，而且估算口径与 tokenEstimator 一致。
 */

import * as path from 'node:path';
import { log } from '../log';
import { estimateTextTokens } from './memory/tokenEstimator';

/** 假 encoding：只需要满足 encode(text).length 的用法 */
function createLocalEncoding() {
  return {
    encode: (text: string) => ({ length: estimateTextTokens(text) }),
  };
}

/** 已打过补丁的模块绝对路径，避免重复安装 */
const patched = new Set<string>();

/**
 * 从某个包的解析位置出发，找到它实际使用的 @langchain/core 里的 tiktoken 工具模块
 *
 * 必须按包的解析路径去找：pnpm 下 @langchain/core 有多份副本（本次实测同一仓库
 * 里就有 0.3.80×2 和 1.2.13），改错副本等于没改。
 */
function resolveTiktokenModule(fromPackage: string): string | null {
  try {
    const packageEntry = require.resolve(fromPackage, { paths: [path.resolve(__dirname, '../../../..')] });
    // @langchain/openai 的入口在 dist/ 下，向上两级就是包根，再取它链接到的 core
    const coreEntry = require.resolve('@langchain/core', { paths: [path.dirname(packageEntry)] });
    // core 入口形如 <core>/dist/index.cjs，tiktoken 工具就在 <core>/dist/utils/tiktoken.cjs
    const candidate = path.join(path.dirname(coreEntry), 'utils', 'tiktoken.cjs');
    return require.resolve(candidate);
  } catch {
    return null;
  }
}

function patchOne(fromPackage: string): void {
  const modulePath = resolveTiktokenModule(fromPackage);
  if (!modulePath || patched.has(modulePath)) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tiktokenModule = require(modulePath);
    if (!tiktokenModule || typeof tiktokenModule.encodingForModel !== 'function') return;

    tiktokenModule.encodingForModel = () => Promise.resolve(createLocalEncoding());
    patched.add(modulePath);
    log.info('[ai] token 计数已切换为本地估算', { via: fromPackage, modulePath });
  } catch (err) {
    log.warn(`[ai] 切换本地 token 估算失败（${fromPackage}），回退 LangChain 默认实现`, err);
  }
}

/**
 * 安装本地 token 估算。幂等，重复调用只生效一次。
 *
 * 两个 provider 都装一遍：@langchain/openai 与 @langchain/anthropic 在 pnpm 下
 * 可能各自链接到不同的 @langchain/core 副本。
 */
export function installOfflineTokenCounter(): void {
  patchOne('@langchain/openai');
  patchOne('@langchain/anthropic');
}
