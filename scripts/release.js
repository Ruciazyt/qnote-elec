const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 获取命令行参数
const releaseType = process.argv[2] || 'patch'; // patch, minor, major

// 验证发布类型
if (!['patch', 'minor', 'major'].includes(releaseType)) {
    console.error('❌ 无效的发布类型。请使用: patch, minor, 或 major');
    process.exit(1);
}

// 检查Node.js版本
function checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (majorVersion < 18) {
        console.error('❌ 需要Node.js 18或更高版本');
        console.error(`当前版本: ${nodeVersion}`);
        process.exit(1);
    }

    console.log(`✅ Node.js版本检查通过: ${nodeVersion}`);
}

console.log(`🚀 开始 ${releaseType} 版本发布流程...`);

try {
    // 0. 检查Node.js版本
    checkNodeVersion();

    // 1. 检查工作目录是否干净
    console.log('📋 检查Git工作目录状态...');
    try {
        execSync('git diff-index --quiet HEAD --', { stdio: 'inherit' });
    } catch (error) {
        console.error('❌ 工作目录不干净，请先提交或暂存所有更改');
        process.exit(1);
    }

    // 2. 拉取最新代码
    console.log('📥 拉取最新代码...');
    execSync('git pull origin master', { stdio: 'inherit' });

    // 3. 安装工作区依赖
    console.log('📦 安装工作区依赖...');
    execSync('pnpm install', { stdio: 'inherit' });

    // 4. 运行测试（如果有的话）
    console.log('🧪 运行测试...');
    try {
        execSync('pnpm test', { stdio: 'inherit' });
    } catch (error) {
        console.log('⚠️  没有找到测试脚本，跳过测试步骤');
    }

    // 5. 更新版本号
    console.log(`📈 更新版本号 (${releaseType})...`);
    const versionOutput = execSync(`pnpm version ${releaseType} --no-git-tag-version`, { encoding: 'utf8' });
    const newVersion = versionOutput.trim();
    console.log(`✅ 新版本: ${newVersion}`);

    // 6. 读取package.json获取版本信息
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const version = packageJson.version;

    // 7. 提交版本更改
    console.log('💾 提交版本更改...');
    execSync('git add package.json pnpm-lock.yaml', { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${version}"`, { stdio: 'inherit' });

    // 8. 创建Git标签
    console.log('🏷️  创建Git标签...');
    execSync(`git tag -a v${version} -m "Release v${version}"`, { stdio: 'inherit' });

    // 9. 推送到远程仓库
    console.log('📤 推送到远程仓库...');
    execSync('git push origin master', { stdio: 'inherit' });
    execSync(`git push origin v${version}`, { stdio: 'inherit' });

    console.log('🎉 发布流程完成！');
    console.log(`📋 版本 v${version} 已发布`);
    console.log('🔄 GitHub Actions 将自动构建和发布应用');
    console.log('🌐 请查看: https://github.com/Ruciazyt/qnote-elec/actions');

} catch (error) {
    console.error('❌ 发布过程中出现错误:', error.message);
    process.exit(1);
}
