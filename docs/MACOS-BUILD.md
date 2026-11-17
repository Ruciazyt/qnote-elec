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


## 七、已知限制

- **`qnote-note://` 协议没有在系统层注册**。应用内部的预览走
- **屏幕录制权限不涉及**。OCR 走的是渲染层的画布抓取，不是系统级截屏，
- **没有做 macOS 沙箱**。沙箱会让应用无法访问用户自定义的笔记目录、
