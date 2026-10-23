const fs = require('fs');
const path = require('path');

async function createPortableZip() {
    return new Promise((resolve, reject) => {
        const archiver = require('archiver');

        const distPath = path.join(process.cwd(), 'dist_electron');
        const unpackedDir = path.join(distPath, 'win-unpacked');

        if (!fs.existsSync(unpackedDir)) {
            console.log('📁 未找到win-unpacked目录，跳过便携版处理');
            resolve(null);
            return;
        }

        // 读取package.json获取版本号
        const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
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

        // 将整个win-unpacked目录添加到zip中，但重命名为QNote-portable
        archive.directory(unpackedDir, 'QNote-portable');
        archive.finalize();
    });
}

async function processPortableFiles() {
    try {
        console.log('🔄 开始处理便携版文件...');

        const zipName = await createPortableZip();

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
    processPortableFiles().catch(error => {
        console.error('❌ 后处理失败:', error.message);
        process.exit(1);
    });
}

module.exports = { processPortableFiles }; 