const fs = require('fs');
const path = require('path');

/**
 * 便携版标记文件名
 *
 * 与主进程 src/main/core/updater.ts 里的 PORTABLE_MARKER 必须一致。
 * 便携版没有安装器，无法"覆盖安装自己"——NSIS 安装器只会把新版本装到
 * 程序目录去，用户手里的便携目录还是旧的。所以便携版必须关闭自动更新，
 * 改成引导用户去下载页手动替换。
 *
 * 写标记的时机在压缩之前：NSIS 安装版在 build:app 阶段就已经打好，
 * 不受这个文件影响，因此只有便携版压缩包里会带上它。
 */
const PORTABLE_MARKER = 'portable.marker';

/**
 * 仓库根目录 —— 构建产物目录必须落在这个范围之内
 *
 * electron-builder 的产物目录本来就定义在仓库根下
 * （package.json build.directories.output），所以这里以仓库根为基准。
 */
const ROOT = path.resolve(__dirname, '../..');

/** 在便携版目录里写入标记文件 */
function writePortableMarker(unpackedDir) {
    // unpackedDir 来自命令行传入的产物目录，写文件之前独立再校验一次：
    // 目标必须仍在仓库根之内，否则一次路径穿越就能把标记写到仓库外。
    // 判定方式与主进程 src/main/core/noteStore.ts 的 resolveSafe 一致。
    const unpackedDirAbs = path.resolve(ROOT, unpackedDir);
    const unpackedRel = path.relative(ROOT, unpackedDirAbs);
    if (unpackedRel.startsWith('..') || path.isAbsolute(unpackedRel)) {
        throw new Error(`便携版目录必须位于仓库根目录之内: ${unpackedDir}`);
    }

    const resourcesDir = path.join(unpackedDirAbs, 'resources');
    if (!fs.existsSync(resourcesDir)) {
        console.warn('⚠️ 未找到 resources 目录，跳过便携版标记写入');
        return false;
    }
    const markerPath = path.join(resourcesDir, PORTABLE_MARKER);
    fs.writeFileSync(
        markerPath,
        'QNote portable build. 自动更新不可用，请手动下载新版本替换本目录。\n',
        'utf8'
    );
    console.log(`✅ 便携版标记已写入: ${markerPath}`);
    return true;
}

/**
 * 创建便携版 ZIP
 *
 * outputDir 是构建产物目录（默认 dist_electron）。做成参数是为了能对
 * 其它输出目录复用同一套逻辑（例如验证构建时指定目录）。
 */
async function createPortableZip(outputDir = 'dist_electron') {
    return new Promise((resolve, reject) => {
        // outputDir 来自命令行，先解析成绝对路径再确认它落在仓库根之内 ——
        // 不校验就拼接，等于允许 "../../evil" 这类越界写入（SonarCloud S8707）。
        // 校验放在最前面：参数不合法就没必要再往下走。
        const distPath = path.resolve(ROOT, outputDir);
        const distRel = path.relative(ROOT, distPath);
        if (distRel.startsWith('..') || path.isAbsolute(distRel)) {
            throw new Error(`构建产物目录必须位于仓库根目录之内: ${outputDir}`);
        }

        const archiver = require('archiver');

        const unpackedDir = path.join(distPath, 'win-unpacked');

        if (!fs.existsSync(unpackedDir)) {
            console.log('📁 未找到win-unpacked目录，跳过便携版处理');
            resolve(null);
            return;
        }

        // 读取package.json获取版本号（路径同样以仓库根为基准，不受调用时 cwd 影响）
        const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const version = packageJson.version;

        const zipName = `QNote-${version}-portable.zip`;
        const zipPath = path.join(distPath, zipName);

        console.log(`📦 正在创建便携版ZIP: ${zipName}`);

        // 创建zip文件
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`✅ 便携版ZIP创建完成: ${zipName} (${(archive.pointer() / (1024 * 1024)).toFixed(2)} MB)`);

            // 删除win-unpacked目录
            fs.rmSync(unpackedDir, { recursive: true, force: true });
            console.log(`🗑️  删除临时目录: win-unpacked`);

            resolve(zipName);
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        // 写便携版标记 —— 必须在压缩之前，否则标记不会进压缩包，
        // 运行时就识别不出这是便携版，会误以为可以自动更新。
        writePortableMarker(unpackedDir);

        // 将整个win-unpacked目录添加到zip中，但重命名为QNote-portable
        archive.directory(unpackedDir, 'QNote-portable');
        archive.finalize();
    });
}

async function processPortableFiles(outputDir = 'dist_electron') {
    try {
        console.log('🔄 开始处理便携版文件...');

        const zipName = await createPortableZip(outputDir);

        if (zipName) {
            console.log('✅ 便携版处理完成！');
            console.log(`📦 便携版文件: ${zipName}`);
            console.log('\n📋 使用说明:');
            console.log(`  1. 解压 ${zipName}`);
            console.log('  2. 进入 QNote-portable 文件夹');
            console.log('  3. 双击 QNote.exe 运行');
            console.log('  4. 数据将保存在程序目录下');
        } else {
            console.log('📁 未找到需要处理的文件，跳过便携版处理');
        }
    } catch (error) {
        console.error('❌ 便携版处理失败:', error.message);
        throw error;
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    // 允许传参指定构建产物目录：node scripts/build/post-build.js [outputDir]
    const outputDir = process.argv[2] || 'dist_electron';
    processPortableFiles(outputDir).catch(error => {
        console.error('❌ 后处理失败:', error.message);
        process.exit(1);
    });
}

module.exports = { processPortableFiles, writePortableMarker };