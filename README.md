# DSH Sub2API Status

在 DeepSeek Harness（DSH）输入框下方的原生状态栏中显示当前 API 的 **计费倍率和钱包余额**，点击读数可查看详细用量。

```text
倍率 3× · 余额 $12.34
```

插件自动跟随当前会话选择的模型，复用 DSH 已配置的 API 地址和 Key，无需重复填写。无法识别为 Sub2API 或没有可查询的配置时显示“未知”。

## 界面预览

输入框下方显示倍率与余额，点击可查看用量详情。

![状态栏与用量详情](<截图-1.png>)

在原生 Sub2API 设置页中，可调整请求时间和详情显示项。

![Sub2API 设置页](<截图-2.png>)

## 功能

- 显示当前有效 Token 计费倍率，包含用户倍率和高峰时段配置的影响。
- 钱包余额四舍五入并固定显示两位小数。
- 点击读数打开与 DSH 原生统计浮窗风格一致的详情窗，支持点击外部或按 Esc 关闭。
- 详情可展示倍率明细、账户与套餐、Key 额度、周期限额、套餐额度、今日与累计用量、请求统计、每日用量及模型统计。
- 使用 DSH 原生设置页选择详情窗显示哪些数据。
- 同一浏览器内使用相同站点和 Key 的模型共享数据与刷新任务。

## 要求

- 已适配并验证 **DSH Desktop 0.2.0-rc.2**；其他版本需要提供兼容的插槽、模型目录和原生设置服务。
- 当前模型的供应商配置需要提供 `baseURL` 和 API Key。OAuth 或未暴露 API 站点的路由显示“未知”。
- 查询站点需要支持相应的 Sub2API 接口。较旧版本或定制部署可能只返回部分数据。

插件查询路由目前仅接受本机访问，适合本地运行的 DSH GUI。

## 安装

GitHub 仓库：[487666123/dsh-sub2api-status](https://github.com/487666123/dsh-sub2api-status)。

### Web profile

```powershell
dsh plugin --profile web add github:487666123/dsh-sub2api-status
```

安装后重启对应的 `dsh web` 进程，再刷新现有 GUI。

### DSH Desktop

使用桌面版提供的插件安装入口或配套 CLI，安装到 `desktop` profile，包地址为：

```text
github:487666123/dsh-sub2api-status
```

配套 CLI 的参数形式：

```powershell
dsh plugin --profile desktop add github:487666123/dsh-sub2api-status
```

应使用能够管理 Desktop profile 的桌面版 CLI；独立安装的普通 `dsh` CLI 可能限制对该 profile 的操作。安装后重启桌面应用。

仓库包含已构建的客户端入口，安装后无需手动构建。插件通过 `dsh.bundle` 自动挂载，无需手工向 profile 添加源码路径。

## 使用与刷新

选择模型后，输入框下方状态栏会显示“倍率”和“余额”。点击读数查看详情，浮窗右上角的“刷新”按钮可立即发起查询。

刷新时序：

```text
发送请求 → 成功、失败或超时结束 → 等待配置的间隔 → 下一次请求
```

- **默认等待时间：5000 ms（5 秒）**，从上一次请求结束开始计时，可在设置中修改。
- **默认请求超时：10000 ms（10 秒）**，可在设置中修改；超时后同样等待配置的间隔再查询。
- 手动刷新共用正在进行的任务，不并发重复请求，也不返回宿主旧缓存。
- 页面隐藏时暂停自动计时，恢复可见后更新；没有展示订阅者时释放刷新任务。
- 切换到不同 API 配置时确认新的来源；相同来源的模型复用数据与任务。
- 打开和关闭详情窗不会重启刷新任务。

首次查询失败且没有历史数据时显示“未知”。已有成功数据时，后续查询失败会保留上次结果，并注明“更新失败”或“数据已过期”。倍率和用量接口部分失败时，分别保留对应的旧字段。

## 插件设置

在 DSH 设置窗口左侧点击 **“Sub2API”**。页面顶部提供两个请求配置输入框：

| 配置项 | 默认值 | 含义 |
| --- | --- | --- |
| 数据请求超时（ms） | 10000 | 单次请求的最长等待时间，同时用于浏览器和宿主；保存后用于下一次请求 |
| 数据请求间隔（ms） | 5000 | 上一次请求结束后的等待时间；保存后重新计算正在等待的任务 |

输入范围为 1–2147483647 的整数，单位为毫秒；留空或点击该字段的“恢复默认”后保存，可恢复默认值。修改在点击“保存”前只保留为草稿。

下方提供以下 11 个详情显示开关：

| 显示项 | 内容 |
| --- | --- |
| 当前 API、倍率与余额 | 站点、模型、有效倍率、钱包余额 |
| 倍率明细与高峰时段 | 分组倍率、用户倍率、高峰时间及系数 |
| 账户与套餐信息 | 计费模式、套餐名称、Key 状态和到期时间 |
| Key 总额度 | 额度上限、已用、剩余 |
| 5 小时 / 1 天 / 7 天额度 | 已配置窗口的上限、用量、剩余和重置时间 |
| 套餐日 / 周 / 月额度 | 套餐周期用量、上限和到期时间 |
| 今日用量 | 当前 Key 今日请求数、Token 和费用 |
| 累计用量 | 当前 Key 累计请求数、Token 和费用 |
| 请求统计 | 接口提供的平均耗时、RPM 和 TPM |
| 每日用量列表 | 可展开的每日请求、Token 和费用 |
| 模型统计列表 | 可展开的各模型请求、Token 和费用 |

所有分区默认开启。修改后点击 **“保存”**，详情窗立即更新。点击“恢复默认显示项”只恢复草稿，仍需保存；离开设置页会丢弃未保存的修改。

这些开关只控制详情窗展示，底部倍率与余额读数保持显示。关闭某项不会停止查询对应数据。

设置使用 DSH 的 `Config` schema、`configForms`、`SettingsFormModel`、`SettingsForm`、`Switch` 和 `Button`，保存到当前 profile，不另建配置文件或使用 localStorage。

## 数据含义

宿主使用当前模型的 Key 查询：

```http
GET /v1/sub2api/billing
GET /v1/usage
Authorization: Bearer <当前模型的 API Key>
```

- 主读数使用 `effective_rate_multiplier`，表示查询时刻的有效 Token 计费倍率。
- 余额只使用钱包 `balance` 字段。套餐剩余额度或 Key 剩余额度不会当作钱包余额；接口未提供钱包余额时显示“未知”。
- 请求、Token 和费用统计属于当前 API Key；套餐用量可能由同一分组的多个 Key 共享；钱包余额属于拥有该 Key 的用户。
- 只显示接口实际返回的数据。某个分区开启后仍未出现，可能是当前计费模式或站点版本没有返回对应字段。
- “今日”、周期窗口及重置时间使用站点返回的数据，不根据本地时区重新推算。

API Key 仅在宿主使用，不发送到浏览器、不写入插件目录。浏览器只取得随机签名的匿名来源标识。外部请求不跟随重定向，宿主路由复用 DSH 原生浏览器认证。

## 开发

```powershell
git clone https://github.com/487666123/dsh-sub2api-status.git
cd dsh-sub2api-status
npm install
npm run build
dsh plugin --profile web add .
```

修改源代码后重新运行 `npm run build`，并重启对应 DSH 进程、刷新 GUI。`client.js` 是构建产物，不直接编辑。只有已确认启用针对插件的 HMR 构建监视器时，才可依赖自动更新。

### 模块职责

| 模块 | 职责 |
| --- | --- |
| `src/host/request-service.mjs` | 无状态请求服务：解析配置和凭据、查询、校验、投影数据 |
| `src/host/plugin.mjs` | 宿主适配：认证 HTTP 路由、超时及资源释放，不缓存查询结果 |
| `src/client/request-service.cjs` | 无状态浏览器接口客户端 |
| `src/client/data-center.cjs` | 数据中心：保存快照并提供读取、订阅，不请求或计时 |
| `src/client/refresh-service.cjs` | 刷新服务：来源共享、模型绑定、超时、调度和失败保留策略 |
| `src/client/view.cjs` | 展示层：订阅快照与设置、格式化数据、管理详情窗 |
| `src/client/settings.cjs` | 原生设置页、请求时间及显示偏好 |
| `src/client/entry.cjs` | 组合服务、注册插槽、管理插件生命周期 |
| `src/display-options.json` | 宿主 schema 与前端共用的显示项定义 |
| `src/request-options.json` | 宿主 schema、设置表单和刷新服务共用的请求时间定义 |
| `scripts/build-client.mjs` | 将本地模块打包为 DSH 浏览器工厂 |

`index.js` 直接导出宿主实现，包导出的 `./host` 和 `./server` 别名指向同一入口。DSH 挂载使用包根名称，以便同时加载客户端。请求时间通过原生设置保存到当前 profile，默认值与范围由 `src/request-options.json` 定义。

## 卸载

Web profile：

```powershell
dsh plugin --profile web remove dsh-sub2api-status
```

Desktop 使用对应安装入口卸载，或通过桌面配套 CLI 对 `desktop` profile 执行相同操作。卸载后重启对应 DSH 进程。

本地开发若曾手工添加源码挂载，还需移除对应的 profile patch 条目，避免残留或重复挂载。

## 排障

- **状态栏没有出现**：确认安装到了正在使用的 profile，重启 DSH 后刷新 GUI，并检查版本是否提供兼容的 `conversation.composer.dock` 插槽。宿主挂载名称应为包根入口 `dsh-sub2api-status`；当前适配版本不会从 `dsh-sub2api-status/server` 子入口发现客户端，这会导致宿主运行而状态栏与设置同时缺失。
- **倍率或余额显示未知**：检查当前模型的 API 地址与凭据，以及站点是否支持对应接口；只有额度或套餐信息时，钱包余额仍可能未知。
- **显示更新失败**：浮窗会保留历史成功数据并说明失败原因；检查网络与 Key 状态，随后手动刷新或等待自动重试。
- **设置页没有出现**：在设置窗口左侧查找“Sub2API”，确认 DSH 版本支持原生配置表单与 `settings.section` 插槽，并已重新加载插件、刷新 GUI。
- **出现 duplicate exact route 错误**：插件被重复挂载。检查 profile patch，移除额外添加的源码入口，保留插件包自动注册的 `sub2api-status-server`。
- **修改源码后页面没有变化**：先重新构建，再重启当前 DSH 进程并刷新现有 GUI。

## License

MIT
