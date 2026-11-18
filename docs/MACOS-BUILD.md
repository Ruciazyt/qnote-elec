# macOS 打包说明

[AGENTS.md](../AGENTS.md) 第 6.3 节，本文件只讲操作。

## 一、产物形态

| 产物 | 说明 |
| --- | --- |
| `QNote-<版本>-mac-arm64.dmg` | Apple Silicon（M 系列）安装镜像 |
| `QNote-<版本>-mac-x64.dmg` | Intel 安装镜像 |
| `QNote-<版本>-mac-arm64.zip` | 自动更新用的包（arm64） |
| `QNote-<版本>-mac-x64.zip` | 自动更新用的包（x64） |
| `*.dmg.blockmap` / `*.zip.blockmap` | 差分更新的依据，让更新只传变化的部分 |
| `latest-mac.yml` | 自动更新元数据，记录版本号、文件名、SHA512 |





## 二、mac 产物是否进正式 Release


- 仓库变量 `MAC_RELEASE_ENABLED` 设为 `true`；
- 产物已签名**且**已公证（见第三、四节）。这种包用户双击就能打开，


```
Settings → Secrets and variables → Actions → Variables → New repository variable
Name:  MAC_RELEASE_ENABLED
Value: true
```




## 三、配置代码签名


```bash
# 导出时设置一个口令，后面要用
security create-keychain -p <口令> build.keychain
security import DeveloperID_Application.p12 -k build.keychain -P <口令> -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k <口令> build.keychain
security find-identity -v build.keychain
```


| Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | `.p12` 文件的 base64 内容 |
| `MAC_CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的口令 |


```
Name:  SIGN_WITH_APPLE_CERTIFICATE
Value: true
```



## 四、配置公证


| Secret | 内容 |
| --- | --- |
| `APPLE_ID` | Apple 账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该账号的应用专用密码（在 Apple ID 后台生成，不是登录密码） |
| `APPLE_TEAM_ID` | 开发者团队 ID（10 位字母数字） |



## 五、用户拿到未签名包时怎么装


1. **右键点击应用 → 打开 → 再点一次「打开」**。系统会把这次操作记下来，
2. 在「系统设置 → 隐私与安全性」里找到被拦截的提示，点「仍要打开」。
3. 终端执行：

   ```bash
   xattr -dr com.apple.quarantine /Applications/QNote.app
   ```



## 六、本地验证


```bash
pnpm install --frozen-lockfile
pnpm run build:react
pnpm run build:electron
pnpm run build:app -- --mac --arm64 --x64 --publish never
```



```bash
pnpm run generate:icons
```

生成的 `build/icon.icns` 含 32 / 64 / 128 / 256 / 512 / 1024 六个尺寸。
mac 应用图标是满幅方形（圆角由系统遮罩加），窗口图标保留圆角。
菜单栏图标从 `src/renderer/public/tray.svg` 生成透明背景的单色模板，
输出 `resources/trayTemplate.png`（16px）与 `trayTemplate@2x.png`（32px），
系统根据菜单栏背景自动调整颜色。

## 七、自动更新在 macOS 上走自研通道

Windows 用 electron-updater 的原生安装器（NSIS），macOS 不走这条路。

原因是 Squirrel.Mac 的校验语义：它用**当前运行中 app 的 designated requirement**
去校验新下载的 `.app`（`SQRLCodeSignature.verifyBundleAtURL` 调
`SecStaticCodeCheckValidityWithErrors`）。对没有 Developer ID 签名的 app，这个
requirement 会退化成 `cdhash` 比对 —— 新旧版本字节不同就必然不成立，
报错形如 `code has no resources but signature indicates they must be present`。
这不是打包配置能调好的，`identity` / `hardenedRuntime` 怎么改都没用。

所以 macOS 上由应用自己完成安装（`src/main/core/update/macInstaller.ts`）：

1. 等应用进程退出（覆盖正在运行的 Mach-O 会 ETXTBSY）；
2. `ditto -x -k` 解包更新包；
3. `xattr -dr com.apple.quarantine` 清隔离属性，否则首次启动会被 Gatekeeper 拦；
4. `codesign --force --deep --sign -` 做 ad-hoc 重签，重新生成 `_CodeSignature/CodeResources`；
5. 旧 bundle 改名 `.old` 备份，新 bundle 换上去，失败就回滚；
6. `open` 重新启动。

日志落在 `~/Library/Application Support/QNote/qnote-mac-updater/install.log`。

拿到 Apple Developer ID 证书并公证后，这条通道可以撤掉，macOS 改回原生安装器。

## 八、已知限制

- **`qnote-note://` 协议没有在系统层注册**。应用内部的预览走
- **屏幕录制权限不涉及**。OCR 走的是渲染层的画布抓取，不是系统级截屏，
- **没有做 macOS 沙箱**。沙箱会让应用无法访问用户自定义的笔记目录、
