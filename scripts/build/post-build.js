const fs = require('node:fs');
const path = require('node:path');

const PORTABLE_MARKER = 'portable.marker';

const ROOT = path.resolve(__dirname, '../..');

function writePortableMarker(unpackedDir) {
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

async function createPortableZip(outputDir = 'dist_electron') {
    return new Promise((resolve, reject) => {
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

        const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const version = packageJson.version;

        const zipName = `QNote-${version}-portable.zip`;
        const zipPath = path.join(distPath, zipName);

        console.log(`📦 正在创建便携版ZIP: ${zipName}`);

        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`✅ 便携版ZIP创建完成: ${zipName} (${(archive.pointer() / (1024 * 1024)).toFixed(2)} MB)`);

            fs.rmSync(unpackedDir, { recursive: true, force: true });
            console.log(`🗑️  删除临时目录: win-unpacked`);

            resolve(zipName);
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        writePortableMarker(unpackedDir);

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

if (require.main === module) {
    const outputDir = process.argv[2] || 'dist_electron';
    processPortableFiles(outputDir).catch(error => {
        console.error('❌ 后处理失败:', error.message);
        process.exit(1);
    });
}

module.exports = { processPortableFiles, writePortableMarker };