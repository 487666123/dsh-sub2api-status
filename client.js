window.__ModuleLoader__.load({
    id: 'dsh-sub2api-status',
    factory: (platformRequire) => {
        const factories = {
"src/client/entry.cjs": (module, exports, require) => {
const { createDataCenter } = require("src/client/data-center.cjs");
const { createRequestService } = require("src/client/request-service.cjs");
const { createRefreshService } = require("src/client/refresh-service.cjs");
const { Status, css } = require("src/client/view.cjs");
const { installSettings } = require("src/client/settings.cjs");

function apply(ctx) {
    const center = createDataCenter();
    const settings = installSettings(ctx);
    const refresh = createRefreshService({ requests: createRequestService(), center, preferences: settings.preferences });
    ctx.effect(() => () => { refresh.dispose(); center.clear(); settings.dispose(); });
    ctx.effect(() => {
        const disposers = ['settings/document-updated', 'credentials/reference-updated', 'credentials/record-updated', 'llm/adapters-updated'].map((event) => ctx.remote.$on(event, () => refresh.invalidate()));
        return () => { for (const dispose of disposers) dispose(); };
    });
    ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-sub2api-status';
        style.textContent = css + '\n.dsh-sub2api-setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsh-sub2api-setting-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}.dsh-sub2api-settings>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px 16px}.dsh-sub2api-settings>div>p,.dsh-sub2api-setting-fields{grid-column:1/-1}.dsh-sub2api-setting-fields>div:not(.dsh-sub2api-setting-row){margin-bottom:20px}.dsh-sub2api-setting-reset{justify-self:start;align-self:end}.dsh-sub2api-settings>div>div:last-child{grid-column:2;display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;gap:8px}.dsh-sub2api-settings>div>div:last-child>button{min-width:88px}.dsh-sub2api-settings>div>div:last-child>p{margin:0}';
        document.head.appendChild(style);
        return () => style.remove();
    });
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock', id: 'sub2api-status', order: 100,
        inject: (sessionId) => ({ ...refresh.bindSession(sessionId, ctx.modelDirectories.directoryFor(sessionId), ctx.sessions.subagentAddress(sessionId) === undefined), preferences: settings.preferences })
    }, Status));
}
module.exports = { name: 'sub2api-status-client', inject: ['slots', 'modelDirectories', 'sessions', 'remote', 'configForms'], apply };

},
"src/client/data-center.cjs": (module, exports, require) => {
const EMPTY_SNAPSHOT = Object.freeze({ selection: null, sourceId: null, value: null, phase: 'unknown', stale: false, error: '' });

// 数据中心只保存快照和发布变更，不请求网络、不计时、不判断业务结果。
function createDataCenter() {
    const stores = new Map();
    function storeFor(key) {
        let store = stores.get(key);
        if (store) return store;
        let snapshot = EMPTY_SNAPSHOT;
        const listeners = new Set();
        store = {
            getSnapshot: () => snapshot,
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            publish(next) {
                if (snapshot === next) return;
                snapshot = Object.freeze(next);
                for (const listener of [...listeners]) listener();
            }
        };
        stores.set(key, store);
        return store;
    }
    return { storeFor, clear: () => stores.clear() };
}

module.exports = { createDataCenter, EMPTY_SNAPSHOT };

},
"src/client/request-service.cjs": (module, exports, require) => {
// 浏览器请求服务是无状态的宿主接口客户端，信号和超时由刷新服务提供。
function createRequestService() {
    async function request(path, selection, sourceId, signal) {
        const params = new URLSearchParams({ provider: selection.provider, model: selection.model });
        if (sourceId) params.set('sourceId', sourceId);
        const response = await fetch(`/plugins/dsh-sub2api-status/${path}?${params}`, {
            signal, cache: 'no-store', credentials: 'same-origin'
        });
        if (response.status === 409) {
            const error = new Error('当前模型的 API 配置已变更');
            error.code = 'source-changed';
            throw error;
        }
        if (!response.ok) throw new Error(`宿主查询失败（HTTP ${response.status}）`);
        const result = await response.json();
        if (!result || typeof result !== 'object') throw new Error('宿主返回的数据格式不正确');
        return result;
    }
    return {
        resolveSource: (selection, signal) => request('route', selection, null, signal),
        query: (selection, sourceId, signal) => request('status', selection, sourceId, signal)
    };
}
module.exports = { createRequestService };

},
"src/client/refresh-service.cjs": (module, exports, require) => {
const { EMPTY_SNAPSHOT } = require("src/client/data-center.cjs");
const requestOptions = require("src/request-options.json");
const UNKNOWN = Object.freeze({ identified: false, multiplier: null, balance: null, reason: '当前 API 未知' });

// 刷新服务拥有任务、超时和来源绑定；数据中心只接收它生成的快照。
function createRefreshService({ requests, center, preferences, visibility = document }) {
    const bindings = new Map();
    const tasks = new Map();
    let timing = Object.fromEntries(requestOptions.map((option) => [option.key, option.default]));
    let disposed = false;
    const active = () => !disposed && !visibility.hidden;
    const selectionKey = (selection) => selection ? JSON.stringify([selection.provider, selection.model]) : '';

    function scheduleTask(task, completedAt = Date.now()) {
        clearTimeout(task.timer);
        task.completedAt = completedAt;
        task.timer = setTimeout(() => { task.timer = null; void run(task); }, Math.max(0, completedAt + timing.requestIntervalMs - Date.now()));
    }
    function scheduleResolve(binding, completedAt = Date.now()) {
        clearTimeout(binding.resolveTimer);
        binding.resolveTimer = null;
        binding.completedAt = completedAt;
        binding.resolveTimer = setTimeout(() => { binding.resolveTimer = null; void resolveBinding(binding); }, Math.max(0, completedAt + timing.requestIntervalMs - Date.now()));
    }
    function synchronizeTiming() {
        const value = preferences?.getSnapshot().value || {};
        const next = Object.fromEntries(requestOptions.map((option) => {
            const input = value[option.key];
            return [option.key, Number.isInteger(input) && input >= option.min && input <= option.max ? input : option.default];
        }));
        const intervalChanged = next.requestIntervalMs !== timing.requestIntervalMs;
        timing = next;
        if (!intervalChanged || !active()) return;
        // 等待中的任务按上一次完成时间重新计算；在途请求保持启动时的超时设置。
        for (const task of tasks.values()) if (task.timer && !task.operation) scheduleTask(task, task.completedAt);
        for (const binding of bindings.values()) if (binding.resolveTimer && binding.users) scheduleResolve(binding, binding.completedAt);
    }

    function publishBinding(binding, snapshot) {
        binding.record.publish({ ...snapshot, selection: binding.selection, sourceId: binding.sourceId });
    }
    function detach(binding) {
        binding.sourceOff?.();
        binding.sourceOff = null;
        const task = tasks.get(binding.sourceId);
        task?.bindings.delete(binding);
        if (task && task.bindings.size === 0) {
            clearTimeout(task.timer);
            task.controller?.abort();
            tasks.delete(task.id);
        }
        binding.sourceId = null;
    }
    function clearBinding(binding) {
        binding.generation += 1;
        binding.resolveController?.abort();
        clearTimeout(binding.resolveTimer);
        binding.resolveTimer = null;
        detach(binding);
    }

    function mergeResult(previous, result) {
        const data = { ...result.data };
        const failures = [];
        if (result.outcomes.billing === 'error') {
            failures.push('倍率');
            if (previous?.billing) { data.billing = previous.billing; data.multiplier = previous.multiplier; }
        }
        if (result.outcomes.usage === 'error') {
            failures.push('余额与用量');
            if (previous?.usage) { data.usage = previous.usage; data.balance = previous.balance; }
        }
        if (failures.length === 2) {
            return { value: previous ?? UNKNOWN, phase: 'error', stale: previous?.identified === true, error: result.error || '查询失败，等待自动重试' };
        }
        if (failures.length) {
            data.identified = data.identified || Boolean(data.billing || data.usage);
            // 部分更新不能把保留的旧字段标记为本次完整更新。
            const retained = Boolean((result.outcomes.billing === 'error' && previous?.billing) || (result.outcomes.usage === 'error' && previous?.usage));
            if (retained && previous?.updatedAt) data.updatedAt = previous.updatedAt;
            return { value: data, phase: 'partial', stale: retained, error: `${failures.join('、')}更新失败${retained ? '，保留上次成功数据' : ''}；${result.error || '等待自动重试'}` };
        }
        if (!data.identified && previous?.identified) return { value: previous, phase: 'error', stale: true, error: '查询接口当前不可用，保留上次成功数据' };
        return { value: data, phase: data.identified ? 'ready' : 'unknown', stale: false, error: '' };
    }

    function run(task) {
        if (!active() || !task.bindings.size || task.operation) return task.operation;
        clearTimeout(task.timer);
        const binding = task.bindings.values().next().value;
        const selection = { ...binding.selection };
        task.controller = new AbortController();
        const controller = task.controller;
        const timeoutMs = timing.requestTimeoutMs;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const previous = task.store.getSnapshot();
        task.store.publish({ ...previous, phase: previous.value ? 'refreshing' : 'loading' });
        task.operation = (async () => {
            try {
                const result = await requests.query(selection, task.id, controller.signal);
                if (disposed || tasks.get(task.id) !== task || controller.signal.aborted) return;
                if (result.sourceId !== task.id || !result.outcomes || !result.data) throw new Error('查询结果来源不匹配');
                task.store.publish({ ...previous, ...mergeResult(previous.value, result) });
            } catch (error) {
                if (disposed || tasks.get(task.id) !== task) return;
                if (error.code === 'source-changed') {
                    for (const member of [...task.bindings]) void resolveBinding(member);
                    return;
                }
                task.store.publish({ ...previous, phase: 'error', stale: previous.value?.identified === true,
                    error: controller.signal.aborted ? `查询超时（${timeoutMs} ms），保留上次成功数据` : error.message || '查询失败，保留上次成功数据' });
            } finally {
                clearTimeout(timeout);
                task.operation = null;
                task.controller = null;
                // 仅在本次操作结束后安排下一次，手动刷新也复用同一在途操作。
                if (tasks.get(task.id) === task && task.bindings.size && active()) scheduleTask(task);
            }
        })();
        return task.operation;
    }

    async function resolveBinding(binding) {
        if (!binding.users || !binding.selection || !binding.available || !active()) return;
        const generation = ++binding.generation;
        binding.resolveController?.abort();
        clearTimeout(binding.resolveTimer);
        binding.resolveTimer = null;
        const controller = new AbortController();
        binding.resolveController = controller;
        const timeoutMs = timing.requestTimeoutMs;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const descriptor = await requests.resolveSource(binding.selection, controller.signal);
            if (disposed || generation !== binding.generation || !binding.users || controller.signal.aborted) return;
            if (!descriptor.sourceId) {
                detach(binding);
                publishBinding(binding, { ...EMPTY_SNAPSHOT, value: { ...UNKNOWN, reason: descriptor.reason || '当前模型没有可查询的 API 配置' } });
                scheduleResolve(binding);
                return;
            }
            if (binding.sourceId === descriptor.sourceId && tasks.has(descriptor.sourceId)) {
                const task = tasks.get(descriptor.sourceId);
                if (!binding.sourceOff) binding.sourceOff = task.store.subscribe(() => publishBinding(binding, task.store.getSnapshot()));
                publishBinding(binding, task.store.getSnapshot());
                if (!task.operation && !task.timer) void run(task);
                return;
            }
            detach(binding);
            binding.sourceId = descriptor.sourceId;
            let task = tasks.get(descriptor.sourceId);
            if (!task) {
                task = { id: descriptor.sourceId, store: center.storeFor(`source:${descriptor.sourceId}`), bindings: new Set(), operation: null, controller: null, timer: null };
                tasks.set(task.id, task);
            }
            task.bindings.add(binding);
            binding.sourceOff = task.store.subscribe(() => publishBinding(binding, task.store.getSnapshot()));
            publishBinding(binding, task.store.getSnapshot());
            // 已有来源的任务继续原节奏，不因切换同站点模型而重复请求。
            if (!task.operation && !task.timer) void run(task);
        } catch (error) {
            if (disposed || generation !== binding.generation || !binding.users) return;
            const previous = binding.record.getSnapshot();
            publishBinding(binding, { ...previous, phase: 'error', stale: previous.value?.identified === true,
                error: controller.signal.aborted ? `解析 API 配置超时（${timeoutMs} ms）` : error.message || '解析 API 配置失败' });
            if (active()) scheduleResolve(binding);
        } finally {
            clearTimeout(timeout);
            if (binding.resolveController === controller) binding.resolveController = null;
        }
    }

    function synchronize(binding) {
        const selection = binding.directory.store.getSnapshot().current;
        if (selectionKey(selection) === selectionKey(binding.selection)) return;
        binding.generation += 1;
        binding.resolveController?.abort();
        clearTimeout(binding.resolveTimer);
        binding.resolveTimer = null;
        binding.sourceOff?.();
        binding.sourceOff = null;
        binding.selection = selection ? { provider: selection.provider, model: selection.model } : null;
        if (!binding.selection || !binding.available) detach(binding);
        publishBinding(binding, { ...EMPTY_SNAPSHOT, phase: selection && binding.available ? 'loading' : 'unknown' });
        void resolveBinding(binding);
    }
    function start(binding) {
        binding.directoryOff = binding.directory.store.subscribe(() => synchronize(binding));
        // 服务启动时校准当前模型；组件只负责订阅快照。
        const before = selectionKey(binding.selection);
        synchronize(binding);
        if (binding.selection && !binding.sourceId && before === selectionKey(binding.selection)) void resolveBinding(binding);
        if (binding.available) void binding.directory.load().catch(() => {});
    }
    function stop(binding) {
        clearBinding(binding);
        binding.directoryOff?.();
        binding.directoryOff = null;
    }
    function bindSession(sessionId, directory, available) {
        let binding = bindings.get(sessionId);
        if (binding) return binding.public;
        binding = { record: center.storeFor(`session:${sessionId}`), directory, available, selection: null, sourceId: null, users: 0, generation: 0 };
        binding.public = {
            store: {
                getSnapshot: binding.record.getSnapshot,
                subscribe(listener) {
                    const off = binding.record.subscribe(listener);
                    binding.users += 1;
                    if (binding.users === 1) start(binding);
                    return () => {
                        off();
                        binding.users -= 1;
                        if (binding.users === 0) stop(binding);
                    };
                }
            },
            refresh: () => {
                const task = tasks.get(binding.sourceId);
                if (task) return run(task);
                return resolveBinding(binding);
            }
        };
        bindings.set(sessionId, binding);
        return binding.public;
    }
    function invalidate() {
        for (const binding of bindings.values()) if (binding.users) void resolveBinding(binding);
    }
    function onVisibility() {
        for (const task of tasks.values()) {
            clearTimeout(task.timer);
            task.timer = null;
            if (active()) void run(task);
        }
        for (const binding of bindings.values()) {
            clearTimeout(binding.resolveTimer);
            binding.resolveTimer = null;
            if (active() && binding.users && !binding.sourceId) void resolveBinding(binding);
        }
    }
    const preferencesOff = preferences?.subscribe(synchronizeTiming);
    synchronizeTiming();
    visibility.addEventListener('visibilitychange', onVisibility);
    return {
        bindSession, invalidate,
        dispose() {
            disposed = true;
            preferencesOff?.();
            visibility.removeEventListener('visibilitychange', onVisibility);
            for (const binding of bindings.values()) stop(binding);
            bindings.clear();
            tasks.clear();
        }
    };
}
module.exports = { createRefreshService };

},
"src/request-options.json": (module, exports, require) => {
module.exports = [{"key":"requestTimeoutMs","label":"数据请求超时（ms）","default":10000,"min":1,"max":2147483647,"hint":"单次请求的最长等待时间，默认 10000 ms。保存后用于下一次请求。"},{"key":"requestIntervalMs","label":"数据请求间隔（ms）","default":5000,"min":1,"max":2147483647,"hint":"上一次请求结束后等待的时间，默认 5000 ms。"}];
},
"src/client/view.cjs": (module, exports, require) => {
const React = require('react');
const { createPortal } = require('react-dom');
const { useAnchoredPosition, useDismissOnOutsidePointer } = require('@deepseek-ai/dsh-client-ui-primitives');
const requestOptions = require("src/request-options.json");
const h = React.createElement;
const EMPTY = Object.freeze({ identified: false, multiplier: null, balance: null, reason: '当前 API 未知' });
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });
const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateText(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '未知';
}
function moneyText(value) { return typeof value === 'number' ? `$${money.format(value)}` : '未知'; }
function countText(value) { return typeof value === 'number' ? number.format(value) : '未知'; }
function multiplierText(value) { return typeof value === 'number' ? `${number.format(value)}×` : '未知'; }

function DetailPanel({ value, provider, model, refresh, snapshot, visibilityOptions, requestTiming }) {
    const sections = [];
    const sectionOptions = { '当前 API': 'showOverview', '计费倍率': 'showBilling', '账户与套餐': 'showAccount', 'Key 总额度': 'showQuota', '套餐额度（分组共享）': 'showSubscription', '今日用量（当前 Key）': 'showToday', '累计用量（当前 Key）': 'showTotal', '请求统计': 'showPerformance' };
    const row = (label, value) => [label, value];
    const add = (title, rows) => {
        if (visibilityOptions[sectionOptions[title]] === false) return;
        sections.push(h('section', { key: title, className: 'dsh-sub2api-section' },
        h('div', { className: 'dsh-sub2api-section-title' }, title),
        h('dl', { className: 'dsh-sub2api-details' }, rows.map(([label, text]) => h(React.Fragment, { key: label }, h('dt', null, label), h('dd', null, text))))));
    };
    const billing = value.billing;
    const usage = value.usage;
    add('当前 API', [row('站点', value.site || '未知'), row('模型', provider && model ? `${provider} / ${model}` : '未知'), row('有效倍率', multiplierText(value.multiplier)), row('钱包余额', moneyText(value.balance))]);
    if (billing) {
        const rows = [row('分组基础倍率', multiplierText(billing.group_rate_multiplier)), row('用户解析倍率', multiplierText(billing.resolved_rate_multiplier)), row('高峰倍率', billing.peak_rate_enabled ? '已启用' : '未启用')];
        if (billing.user_rate_multiplier !== undefined) rows.push(row('用户覆盖倍率', multiplierText(billing.user_rate_multiplier)));
        if (billing.peak_rate_enabled) rows.push(row('高峰时间', `${billing.peak_start || '?'} – ${billing.peak_end || '?'}`), row('高峰倍率值', multiplierText(billing.peak_rate_multiplier)), row('当前高峰系数', multiplierText(billing.applied_peak_multiplier)), row('计费时区', billing.timezone || '未知'));
        add('计费倍率', rows);
    }
    if (usage) {
        const rows = [];
        if (usage.planName) rows.push(row('套餐', usage.planName));
        if (usage.status) rows.push(row('Key 状态', usage.status));
        if (usage.mode) rows.push(row('计费模式', usage.mode === 'quota_limited' ? 'Key 额度限制' : usage.subscription ? '订阅套餐' : '钱包计费'));
        if (usage.expires_at) rows.push(row('Key 到期时间', dateText(usage.expires_at)));
        if (rows.length) add('账户与套餐', rows);
        if (usage.quota) add('Key 总额度', [row('上限', moneyText(usage.quota.limit)), row('已用', moneyText(usage.quota.used)), row('剩余', moneyText(usage.quota.remaining))]);
        for (const limit of visibilityOptions.showRateLimits === false ? [] : usage.rateLimits || []) add(`${({ '5h': '5 小时', '1d': '1 天', '7d': '7 天' })[limit.window] || limit.window}额度`, [row('上限', moneyText(limit.limit)), row('已用', moneyText(limit.used)), row('剩余', moneyText(limit.remaining)), row('重置时间', dateText(limit.reset_at))]);
        const subscription = usage.subscription;
        if (subscription) {
            const rows = [];
            for (const [key, label] of [['daily', '日'], ['weekly', '周'], ['monthly', '月']]) {
                if (subscription[`${key}_usage_usd`] !== undefined) rows.push(row(`${label}用量 / 上限`, `${moneyText(subscription[`${key}_usage_usd`])} / ${moneyText(subscription[`${key}_limit_usd`])}`));
            }
            if (subscription.expires_at) rows.push(row('套餐到期时间', dateText(subscription.expires_at)));
            add('套餐额度（分组共享）', rows);
        }
        for (const [key, title] of [['today', '今日用量（当前 Key）'], ['total', '累计用量（当前 Key）']]) {
            const stats = usage[key];
            if (!stats) continue;
            const rows = [];
            for (const [field, label] of [['requests', '请求数'], ['input_tokens', '输入 Token'], ['output_tokens', '输出 Token'], ['cache_creation_tokens', '缓存写入 Token'], ['cache_read_tokens', '缓存读取 Token'], ['total_tokens', '总 Token']]) {
                if (stats[field] !== undefined) rows.push(row(label, countText(stats[field])));
            }
            if (stats.cost !== undefined) rows.push(row('标准费用', moneyText(stats.cost)));
            if (stats.actual_cost !== undefined) rows.push(row('实际费用', moneyText(stats.actual_cost)));
            add(title, rows);
        }
        if (usage.performance) {
            const rows = [];
            if (usage.performance.average_duration_ms !== undefined) rows.push(row('平均耗时', `${number.format(usage.performance.average_duration_ms / 1000)} 秒`));
            if (usage.performance.rpm !== undefined) rows.push(row('RPM', countText(usage.performance.rpm)));
            if (usage.performance.tpm !== undefined) rows.push(row('TPM', countText(usage.performance.tpm)));
            if (rows.length) add('请求统计', rows);
        }
        // 较长的统计列表折叠展示，避免遮住输入区。
        for (const [key, title, nameKey] of [['dailyUsage', '每日用量', 'date'], ['modelStats', '模型统计', 'model']]) {
            if (visibilityOptions[key === 'dailyUsage' ? 'showDailyUsage' : 'showModelStats'] === false) continue;
            const stats = usage[key];
            if (!stats?.length) continue;
            sections.push(h('details', { key, className: 'dsh-sub2api-series' }, h('summary', null, `${title}（${stats.length} 项）`),
                h('table', null, h('thead', null, h('tr', null, h('th', null, nameKey === 'date' ? '日期' : '模型'), h('th', null, '请求'), h('th', null, 'Token'), h('th', null, '费用'))),
                    h('tbody', null, stats.map((item, i) => h('tr', { key: i }, h('td', null, item[nameKey] || '未知'), h('td', null, countText(item.requests)), h('td', null, countText(item.total_tokens)), h('td', null, moneyText(item.actual_cost ?? item.cost ?? item.total_cost))))))));
        }
    }
    return h(React.Fragment, null,
        h('div', { className: 'dsh-sub2api-title' }, h('span', null, 'Sub2API 用量详情'), h('button', { type: 'button', className: 'dsh-sub2api-refresh', onClick: refresh }, '刷新')),
        h('div', { className: 'dsh-sub2api-rule', 'aria-hidden': true }),
        h('div', { className: 'dsh-sub2api-body' }, sections, snapshot.error && h('p', { className: 'dsh-sub2api-note', role: 'status' }, snapshot.error + (snapshot.stale ? '（显示上次成功数据）' : '')), value.reason && h('p', { className: 'dsh-sub2api-note' }, value.reason)),
        h('div', { className: 'dsh-sub2api-footnote' }, `请求结束后等待 ${requestTiming.requestIntervalMs} ms · ${requestTiming.requestTimeoutMs} ms 超时${value.updatedAt ? ` · ${new Date(value.updatedAt).toLocaleTimeString()} 更新` : ''}`));
}

// 展示层只订阅数据中心快照、格式化数据和管理浮窗交互。
function Status({ store, refresh, preferences }) {
    const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const config = React.useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
    const visibilityOptions = config.value || {};
    const value = snapshot.value || EMPTY;
    const provider = snapshot.selection?.provider;
    const model = snapshot.selection?.model;
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef(null);
    const panelRef = React.useRef(null);
    const dialogId = React.useId();
    const pos = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, side: 'top', gap: 8, margin: 12 });
    useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
    React.useEffect(() => {
        if (!open) return;
        const close = (event) => { if (event.key === 'Escape') { setOpen(false); rootRef.current?.querySelector('button')?.focus(); } };
        document.addEventListener('keydown', close);
        return () => document.removeEventListener('keydown', close);
    }, [open]);
    const multiplier = multiplierText(value.multiplier);
    const balance = moneyText(value.balance);
    const staleLabel = snapshot.stale ? snapshot.phase === 'refreshing' ? '数据已过期' : '更新失败' : '';
    const requestTiming = Object.fromEntries(requestOptions.map((option) => [option.key, visibilityOptions[option.key] ?? option.default]));
    const details = [value.identified ? 'Sub2API' : 'API 未知', value.site,
        provider && model ? `${provider} / ${model}` : null, value.reason, snapshot.error,
        value.updatedAt ? `上次成功更新 ${new Date(value.updatedAt).toLocaleTimeString()}` : null,
        `请求结束后等待 ${requestTiming.requestIntervalMs} ms · ${requestTiming.requestTimeoutMs} ms 超时 · 点击查看详情`].filter(Boolean).join('\n');
    return h('span', { ref: rootRef, className: 'dsh-sub2api-anchor' },
        h('button', { type: 'button', className: 'dsh-sub2api-status', title: details,
            'aria-label': `倍率 ${multiplier}，余额 ${balance}${staleLabel ? `，${staleLabel}` : ''}，查看详情`,
            'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? dialogId : undefined,
            'data-dsh-plugin': 'sub2api-status', onClick: () => setOpen((value) => !value)
        }, h('span', null, `倍率 ${multiplier}`), h('span', { 'aria-hidden': true, className: 'dsh-sub2api-status-separator' }, '·'),
        h('span', null, `余额 ${balance}`), staleLabel && h('span', { className: 'dsh-sub2api-stale' }, staleLabel)),
        open && createPortal(h('div', { id: dialogId, ref: panelRef, className: 'dsh-sub2api-panel', role: 'dialog',
            'aria-label': 'Sub2API 用量详情', style: pos ?? { visibility: 'hidden', left: 0, top: 0 }
        }, h(DetailPanel, { value, provider, model, refresh, snapshot, visibilityOptions, requestTiming })), document.body));
}

const css = '\n.dsh-sub2api-status{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;flex-shrink:0;max-width:100%;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:1px 8px;border-radius:999px;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums}\n.dsh-sub2api-anchor{min-width:0;display:inline-flex}\n.dsh-sub2api-status:hover,.dsh-sub2api-status[aria-expanded=true]{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}\n.dsh-sub2api-status:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}\n.dsh-sub2api-status-separator{color:var(--dsw-alias-separator-primary);margin:0 6px}\n.dsh-sub2api-panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;position:fixed;display:flex;flex-direction:column}\n.dsh-sub2api-title{color:var(--dsw-alias-label-primary);display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:8px;font-weight:500}\n.dsh-sub2api-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}\n.dsh-sub2api-body{overflow-y:auto;min-height:0;max-height:min(480px,calc(100vh - 120px));overscroll-behavior:contain}\n.dsh-sub2api-section+.dsh-sub2api-section{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:10px}\n.dsh-sub2api-section-title{font-weight:500;margin-bottom:6px;color:var(--dsw-alias-label-secondary)}\n.dsh-sub2api-details{color:var(--dsw-alias-label-tertiary);display:grid;grid-template-columns:minmax(100px,auto) minmax(0,1fr);gap:6px 16px;margin:0}\n.dsh-sub2api-details dt,.dsh-sub2api-details dd{min-width:0;margin:0}\n.dsh-sub2api-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}\n.dsh-sub2api-refresh{font:inherit;color:var(--dsw-alias-label-tertiary);background:transparent;border:0;border-radius:var(--dsw-radius-sm);padding:2px 6px;cursor:pointer}\n.dsh-sub2api-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}\n.dsh-sub2api-footnote,.dsh-sub2api-note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:10px 0 0}\n.dsh-sub2api-series{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:10px}\n.dsh-sub2api-series summary{cursor:pointer;font-weight:500}\n.dsh-sub2api-series table{width:100%;border-collapse:collapse;margin-top:6px;font-variant-numeric:tabular-nums}\n.dsh-sub2api-series th,.dsh-sub2api-series td{padding:4px;text-align:right;border-bottom:.5px solid var(--dsw-alias-border-l2)}\n.dsh-sub2api-series th:first-child,.dsh-sub2api-series td:first-child{text-align:left;overflow-wrap:anywhere;max-width:180px}\n\n.dsh-sub2api-stale{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:4px}\n';
module.exports = { Status, css };

},
"src/client/settings.cjs": (module, exports, require) => {
const React = require('react');
const { SettingsForm, SettingsFormModel, SettingsValueField, Switch, Button } = require('@deepseek-ai/dsh-client-ui-primitives');
const options = require("src/display-options.json");
const requestOptions = require("src/request-options.json");
const allOptions = [...requestOptions, ...options];
const h = React.createElement;
const description = '配置请求时间与详情窗展示内容。保存后生效；底部倍率与余额读数保持显示。';

function SettingsPage({ controller }) {
    const state = React.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot);
    return h('section', { className: 'dsh-sub2api-settings', style: { maxWidth: 760 } },
        h('h2', { style: { margin: '0 0 12px', fontSize: 18, fontWeight: 600 } }, 'Sub2API 设置'),
        h('p', { style: { margin: '0 0 16px', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' } }, description),
        h(SettingsForm, {
        state,
        labels: { unavailable: 'Sub2API 插件设置暂不可用', readOnly: '当前设置为只读', saveFailed: '保存失败，请重试', save: '保存', saving: '保存中…' },
        onSave: controller.actions.save, onDiscard: controller.actions.discard
    }, h('div', { className: 'dsh-sub2api-setting-fields' },
        requestOptions.map((option) => h(SettingsValueField, {
            key: option.key, id: `sub2api-${option.key}`, label: option.label, hint: option.hint, numeric: true,
            overriddenLabel: '已覆盖', resetLabel: '恢复默认', invalidLabel: `请输入 ${option.min}–${option.max} 之间的整数`,
            disabled: !state.writable || state.saving, ...state.fields[option.key],
            onEdit: (text) => controller.actions.edit(option.key, text),
            onReset: () => controller.actions.resetField(option.key)
        })),
        options.map((option) => h('div', { key: option.key, className: 'dsh-sub2api-setting-row' },
        h('div', { className: 'dsh-sub2api-setting-label' }, option.label),
        h(Switch, { checked: state.fields[option.key].text === 'true', label: option.label, disabled: !state.writable || state.saving,
            onChange: (checked) => controller.actions.edit(option.key, String(checked)) })))),
        h(Button, { className: 'dsh-sub2api-setting-reset', variant: 'secondary', disabled: !state.writable || state.saving,
            onClick: () => options.forEach((option) => controller.actions.resetField(option.key)) }, '恢复默认显示项')));
}

function installSettings(ctx) {
    const mirror = ctx.configForms.describe();
    let scope;
    let pageOff;
    let currentNs;
    let form;
    const preferences = {
        getSnapshot: () => scope ? scope.getSnapshot() : mirror.getSnapshot(),
        subscribe(listener) {
            let off;
            const sync = () => {
                off?.();
                off = scope?.subscribe(listener);
                listener();
            };
            const mirrorOff = mirror.subscribe(sync);
            sync();
            return () => { mirrorOff(); off?.(); };
        }
    };
    function synchronize() {
        // 原生配置镜像是设置数据的唯一来源，不另建 localStorage 或配置文件。
        const rows = mirror.getSnapshot().view?.namespaces || [];
        const row = rows.find((item) => options.every((option) => typeof item.value?.[option.key] === 'boolean'));
        const ns = row?.ns || 'sub2api-status-server';
        if (ns === currentNs) return;
        pageOff?.();
        form?.dispose();
        currentNs = ns;
        scope = ctx.configForms.get(ns);
        form = new SettingsFormModel(scope, [
            ...options.map((option) => ({
                field: option.key,
                format: (value) => String(typeof value === 'boolean' ? value : option.default),
                parse: (text) => text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined
            })),
            ...requestOptions.map((option) => ({
                field: option.key,
                format: (value) => String(typeof value === 'number' ? value : option.default),
                parse: (text) => {
                    if (!text.trim()) return { kind: 'clear' };
                    const value = Number(text);
                    return /^\d+$/.test(text.trim()) && Number.isInteger(value) && value >= option.min && value <= option.max
                        ? { kind: 'set', value } : undefined;
                }
            }))
        ]);
        const owned = form;
        const controller = {
            store: owned.bind(() => ({ ...owned.shell(), fields: Object.fromEntries(allOptions.map((option) => [option.key, owned.field(option.key)])) })),
            actions: owned.actions()
        };
        pageOff = ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section', id: 'sub2api-status-settings', order: 16, label: () => 'Sub2API',
            inject: () => ({ controller })
        }, SettingsPage));
    }
    const mirrorOff = mirror.subscribe(synchronize);
    mirror.ensure();
    synchronize();
    return { preferences, dispose: () => { mirrorOff(); pageOff?.(); form?.dispose(); } };
}
module.exports = { installSettings };

},
"src/display-options.json": (module, exports, require) => {
module.exports = [{"key":"showOverview","label":"当前 API、倍率与余额","default":true},{"key":"showBilling","label":"倍率明细与高峰时段","default":true},{"key":"showAccount","label":"账户与套餐信息","default":true},{"key":"showQuota","label":"Key 总额度","default":true},{"key":"showRateLimits","label":"5 小时 / 1 天 / 7 天额度","default":true},{"key":"showSubscription","label":"套餐日 / 周 / 月额度","default":true},{"key":"showToday","label":"今日用量","default":true},{"key":"showTotal","label":"累计用量","default":true},{"key":"showPerformance","label":"请求统计","default":true},{"key":"showDailyUsage","label":"每日用量列表","default":true},{"key":"showModelStats","label":"模型统计列表","default":true}];
}
        };
        const cache = new Map();
        function require(id) {
            if (!Object.prototype.hasOwnProperty.call(factories, id)) return platformRequire(id);
            if (cache.has(id)) return cache.get(id).exports;
            const module = { exports: {} };
            cache.set(id, module);
            factories[id](module, module.exports, require);
            return module.exports;
        }
        return require("src/client/entry.cjs");
    }
});
