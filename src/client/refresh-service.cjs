const { EMPTY_SNAPSHOT } = require('./data-center.cjs');
const requestOptions = require('../request-options.json');
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
