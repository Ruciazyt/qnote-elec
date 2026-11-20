# Hello QNote —— 最小示例插件

演示清单、命令注册、通知、设置项、预览页面与生命周期清理。

## 安装

在 QNote 的「插件」页点「导入文件夹」，选这个目录（`examples/plugins/hello-qnote`）。

清单里没有 `engines.qnote` 之外的额外要求，宿主版本满足 `^2.0.0` 即可。

## 运行

1. 导入后在插件列表里点「启动」。
2. 插件进程起来后会通过 SDK 连上宿主的 RPC 通道，`activate()` 里注册命令 `hello.sayHi`。
3. 按 `Ctrl+Shift+P` 打开命令面板，搜「打个招呼」并执行 —— 插件会弹一条通知。
4. 插件页的「设置」里可以改问候语，插件下次执行命令时读到新值。

## 目录

| 文件 | 作用 |
| --- | --- |
| `plugin.json` | 清单：身份、版本、引擎约束、运行期、权限、贡献点 |
| `main.js` | 入口：`activate(ctx)` / `deactivate()` |
| `preview/index.html` | 预览页面（宿主用隔离视图加载） |

## 权限

清单里声明了：

- `process.spawn: true` —— 允许起子进程（不声明就启动不了）
- `qnote.todos: read` —— 允许读待办

调用超出声明范围的接口会被宿主拒绝并记进插件日志。
