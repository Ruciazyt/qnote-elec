const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const outFile = path.join(projectRoot, 'resources', 'catalog', 'credentials.json');
const localFile = path.join(projectRoot, '.data', 'catalog-credentials.json');

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pick(source) {
  const baseUrl = clean(source.baseUrl);
  const appId = clean(source.appId);
  const publicKey = clean(source.publicKey);
  const privateKey = clean(source.privateKey);
  if (!baseUrl || !appId || !publicKey || !privateKey) return null;
  return { baseUrl, appId, publicKey, privateKey };
}

function fromEnv() {
  const picked = pick({
    baseUrl: process.env.QNOTE_CATALOG_BASE_URL,
    appId: process.env.QNOTE_CATALOG_APP_ID,
    publicKey: process.env.QNOTE_CATALOG_PUBLIC_KEY,
    privateKey: process.env.QNOTE_CATALOG_PRIVATE_KEY,
  });
  return picked ? { source: '环境变量', value: picked } : null;
}

function fromLocalFile() {
  try {
    const picked = pick(JSON.parse(fs.readFileSync(localFile, 'utf8')));
    return picked ? { source: '.data/catalog-credentials.json', value: picked } : null;
  } catch {
    return null;
  }
}

function main() {
  const found = fromEnv() || fromLocalFile();
  if (!found) {
    console.warn(
      '\n⚠️  没找到公共目录的 API Key —— 打包出来的应用里「公共目录」会是空的。\n' +
      '   给齐这四个环境变量再打包：QNOTE_CATALOG_BASE_URL / QNOTE_CATALOG_APP_ID /\n' +
      '   QNOTE_CATALOG_PUBLIC_KEY / QNOTE_CATALOG_PRIVATE_KEY\n' +
      '   （或把凭据放到 .data/catalog-credentials.json）'
    );
    return;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(found.value, null, 2) + '\n', 'utf8');
  console.log('\n▶ 公共目录凭据已注入（来源：' + found.source + '）→ resources/catalog/credentials.json');
}

main();