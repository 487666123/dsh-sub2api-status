const EMPTY_SNAPSHOT = Object.freeze({ selection: null, sourceId: null, value: null, phase: 'unknown', stale: false, error: '', lastAttemptAt: null });

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
