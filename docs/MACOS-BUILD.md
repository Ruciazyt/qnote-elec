# macOS 打包说明

本文件说明 QNote 的 macOS 产物怎么打出来、怎么签名、公证，以及用户拿到
未签名包时该怎么安装。代码层面的约束写在
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

dmg 与 zip 同时产出：mac 的自动更新走 zip 通道，dmg 不支持差分更新。

blockmap 必须与产物发布在同一个 Release 里。electron-updater 按
`<产物名>.blockmap` 去取它，算出这次要传哪些数据块；取不到不会报错，
但会退化成整包下载 —— mac 的 zip 约 205MB，每次更新全量拉并不划算。

两个架构在**同一次** electron-builder 调用里构建（`--mac --arm64 --x64`）。
原因见 AGENTS.md 第 6.3 节 —— electron-builder 只会写一份 `latest-mac.yml`，
分两次构建会各写一份，发布到同一个 Release 时互相覆盖。

构建只在 macOS 上进行。electron-builder 不支持在 Windows / Linux 上交叉构建
mac 产物，所以 CI 里 mac 有独立的作业（`build-mac`），跑在 `macos-15` runner。

## 二、mac 产物是否进正式 Release

mac 产物进正式 Release 满足下面任一条件：

- 仓库变量 `MAC_RELEASE_ENABLED` 设为 `true`；
- 产物已签名**且**已公证（见第三、四节）。这种包用户双击就能打开，
  没有 Gatekeeper 的拦截，不需要等维护者再手动开开关。

设置仓库变量的方法：

```
Settings → Secrets and variables → Actions → Variables → New repository variable
Name:  MAC_RELEASE_ENABLED
Value: true
```

**当前仓库已把 `MAC_RELEASE_ENABLED` 设为 `true`**，所以 mac 产物会随正式
Release 一起发布。此时产物尚未签名（没有 Apple 开发者证书），
Release 说明里会写明首次打开需要绕过 Gatekeeper 的办法（见第五节）。

不默认打开的原因是：没有 Apple 开发者证书时产物是未签名的，macOS 的
Gatekeeper 会拦住第一次打开，用户得额外做一步操作（见第五节）。是否值得
取决于分发范围，这个开关留给维护者自己决定。

无论是否发布到正式 Release，mac 产物始终会出现在 Actions Artifact 里，
可以直接下载验证。

## 三、配置代码签名

需要一张 Apple 开发者证书：**Developer ID Application**（不是 App Store
用的那类）。在 Apple Developer 后台创建后，导出 `.p12` 并转成 base64：

```bash
# 导出时设置一个口令，后面要用
security create-keychain -p <口令> build.keychain
security import DeveloperID_Application.p12 -k build.keychain -P <口令> -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k <口令> build.keychain
security find-identity -v build.keychain
```

拿到证书后，在仓库里配置三个 secret：

| Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | `.p12` 文件的 base64 内容 |
| `MAC_CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的口令 |

再加一个仓库变量：

```
Name:  SIGN_WITH_APPLE_CERTIFICATE
Value: true
```

secret 与变量**必须同时**具备才会签名。只配 secret 不开变量，产物仍然是
未签名的 —— GitHub 上的 secret 删不掉（只有本人在网页上能删），
留着它却不加开关，产物会一直带着签名配置而不生效，排查起来很绕。

证书不需要手动导入钥匙串：electron-builder 自己会建临时钥匙串、导入
`CSC_LINK` 指向的 `.p12`、再签名。

## 四、配置公证

公证（notarization）需要另外三个 secret：

| Secret | 内容 |
| --- | --- |
| `APPLE_ID` | Apple 账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该账号的应用专用密码（在 Apple ID 后台生成，不是登录密码） |
| `APPLE_TEAM_ID` | 开发者团队 ID（10 位字母数字） |

三个必须**同时**存在。少一个时 electron-builder 会直接抛
`InvalidConfigurationError` 把整个构建打断，所以 CI 里的判断是
「三个都有就公证，一个都没有就只签名」，不会出现只配一半的情况。

公证成功时，用户双击 dmg 打开应用不会有任何 Gatekeeper 提示。

## 五、用户拿到未签名包时怎么装

未签名（或只签名未公证）的 mac 应用第一次打开会被拦住，
提示「无法验证开发者」。三种绕法，按推荐程度排：

1. **右键点击应用 → 打开 → 再点一次「打开」**。系统会把这次操作记下来，
   以后双击就能直接打开。最省事，也最不容易被安全策略拦。
2. 在「系统设置 → 隐私与安全性」里找到被拦截的提示，点「仍要打开」。
3. 终端执行：

   ```bash
   xattr -dr com.apple.quarantine /Applications/QNote.app
   ```

   这条命令去掉下载时打上的隔离标记，代价是绕过了系统的全部检查，
   不建议在来源不明时使用。

**未签名的 mac 版无法自动更新。** macOS 要求更新包与已安装应用使用同一
签名，electron-updater 在这种情况下会拒绝安装更新。Windows 版不受影响。

## 六、本地验证

在 mac 上验证一次完整构建：

```bash
pnpm install --frozen-lockfile
pnpm run build:react
pnpm run build:electron
pnpm run build:app -- --mac --arm64 --x64 --publish never
```

产物在 `dist_electron/` 下。`build:app` 会自动先生成图标
（`build/icon.icns` 与 `resources/` 下的运行时 PNG），不需要单独跑
`pnpm run generate:icons`。

只想验证图标本身时：

```bash
pnpm run generate:icons
```

生成的 `build/icon.icns` 含 32 / 64 / 128 / 256 / 512 / 1024 六个尺寸。
mac 应用图标是满幅方形（圆角由系统遮罩加），托盘与窗口图标保留圆角。

## 七、已知限制

- **`qnote-note://` 协议没有在系统层注册**。应用内部的预览走
  `protocol.handle`，在 mac 上工作正常；但从浏览器点 `qnote-note://` 链接
  不会拉起应用。需要外部唤起时，要另外处理 macOS 的 `open-url` 事件，
  并在打包配置里补 `mac.protocols`。
- **屏幕录制权限不涉及**。OCR 走的是渲染层的画布抓取，不是系统级截屏，
  macOS 不会弹录屏授权。语音输入会弹麦克风授权，
  打包配置里已写入 `NSMicrophoneUsageDescription`。
- **没有做 macOS 沙箱**。沙箱会让应用无法访问用户自定义的笔记目录、
  无法监听全局快捷键，与现有功能冲突。
