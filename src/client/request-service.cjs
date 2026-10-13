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
