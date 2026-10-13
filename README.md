# DSH Sub2API Status

在 DSH 输入框下方原生状态栏显示 `倍率 3× · 余额 $12.34`，点击打开更多数据详情。

## 使用

- 自动跟随当前会话选择的模型，复用 DSH 的 API 站点与凭据。
- `/v1/sub2api/billing` 查询有效 Token 计费倍率，`/v1/usage` 查询钱包余额和用量。
- 钱包余额固定保留两位小数；套餐或 Key 额度不当作钱包余额。
- 请求结束后等待 5 秒再查询，默认 10 秒超时；手动刷新共用正在进行的任务，直接查询，不返回宿主旧缓存。
- 同一浏览器内使用相同站点和 Key 的模型共享来源数据和刷新任务。
- 首次不可识别或查询失败显示未知；有历史成功数据时，后续失败保留数据并注明更新失败 / 数据已过期。倍率和用量部分失败时分别保留对应旧字段。
- 页面隐藏时暂停计时，恢复显示后更新；没有展示订阅者时释放刷新任务。打开和关闭浮窗不会重启刷新。
- API Key 只在宿主使用，浏览器仅取得随机签名的匿名来源标识；请求不跟随重定向，路由使用 DSH 原生浏览器认证并限制本机访问。

## 设置

刷新现有 GUI，在左侧“插件”页面打开“Sub2API 数据显示”。

可选择详情窗显示的 11 个分区：当前 API 与读数、倍率明细、账户与套餐、Key 总额度、周期额度、套餐额度、今日用量、累计用量、请求统计、每日用量、模型统计。

所有分区默认开启。点击“保存”后立即生效；“恢复默认显示项”先恢复草稿，仍需保存。底部倍率与余额读数不受这些开关影响。未保存的草稿离开页面后丢弃。

设置使用 DSH 的 `Config` schema、`configForms`、`SettingsFormModel`、`SettingsForm`、`Switch` 与 `Button`，保存至当前 profile；不另建配置文件或 localStorage。

## 架构

1. `src/host/request-service.mjs`：无状态请求服务，解析站点和凭据、查询接口、校验和投影计费数据；不保存结果或安排刷新。
2. `src/client/data-center.cjs`：只保存数据快照、提供读取与订阅；不请求、不计时、不判断业务结果。
3. `src/client/refresh-service.cjs`：拥有模型绑定、来源共享、超时、刷新时序、失败保留策略，调用请求服务并更新数据中心。
4. `src/client/view.cjs`：只订阅快照和原生设置、格式化显示、管理浮窗交互；不请求网络或控制刷新计时。

`src/client/request-service.cjs` 是无状态宿主接口客户端；`src/client/settings.cjs` 装配原生设置卡片；`src/client/entry.cjs` 组合各服务并管理插件生命周期。

宿主 `src/host/plugin.mjs` 只提供认证 HTTP 适配和资源释放，不缓存数据。`index.js`、`host.js`、`server.js` 是兼容入口。

`src/display-options.json` 是宿主 schema 与前端显示项共用的字段定义。`client.js` 为构建产物，不直接编辑。

## 开发与安装

```powershell
npm run build
dsh plugin --profile web add F:\Custom\dsh-sub2api-status
```

当前桌面配置已安装，并使用本地源码挂载以避开运行中进程的旧模块缓存。安装或更新后刷新现有 GUI；不支持动态插件图的版本需要重启对应 DSH 进程。

当前适配 DSH Desktop 0.2.0-rc.2。需要模型供应商配置提供 `baseURL` 与 API Key；OAuth 或未暴露 API 站点的路由显示未知。刷新等待时间和请求超时定义在刷新服务模块中。
