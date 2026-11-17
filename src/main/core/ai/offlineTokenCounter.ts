
import * as path from 'node:path';
import { log } from "../system/log";
import { estimateTextTokens } from "./memory/tokenEstimator";

function createLocalEncoding() {
  return {
    encode: (text: string) => ({ length: estimateTextTokens(text) }),
  };
}

const patched = new Set<string>();

function resolveTiktokenModule(fromPackage: string): string | null {
  try {
    const packageEntry = require.resolve(fromPackage, { paths: [path.resolve(__dirname, '../../../..')] });
    const coreEntry = require.resolve('@langchain/core', { paths: [path.dirname(packageEntry)] });
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

export function installOfflineTokenCounter(): void {
  patchOne('@langchain/openai');
  patchOne('@langchain/anthropic');
}
