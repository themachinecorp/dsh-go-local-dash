# local-dash · dsh-go 手机原生仪表盘

给 DSH Go 手机 App 的原生插件：对话详情「插件」页签里的一块仪表盘面板，外加输入框上方的
状态条、一个胶囊、一个长按菜单项和每轮脚注。面板里的数字全部由运行它的引擎实测
（运行时长、常驻内存、界面拉取次数与 12 分钟拉取曲线），不是假数据。

## 安装（主机上）

```sh
dsh plugin --profile web add https://raw.githubusercontent.com/themachinecorp/dsh-go-local-dash/main/local-dash-0.1.0.tgz
```

或从仓库源码装：`dsh plugin --profile web add github:themachinecorp/dsh-go-local-dash`

装完在 App 的「设置 › 插件 › 已安装」里应有「花哨仪表盘」；面板在打开着的对话 →
左缘右滑 →「插件」页签。

## 前提

主机需要带 dsh-go 桥接（`dsh-go-bridge` 插件）。App 侧只有 HTTP 通道（手机本机引擎
或 SSH 主机）会渲染原生界面；经 DSH Remote 中转的连接不支持（App 端
`carrier is! DshHttpCarrier` 直接抛 `dsh-go/unsupported`）。
