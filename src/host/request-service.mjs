import { createHmac } from 'node:crypto';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const UNKNOWN = Object.freeze({ identified: false, multiplier: null, balance: null, reason: '当前 API 未知' });

// 凭据只在宿主解析；来源标识使用进程内随机密钥签名，不向浏览器暴露凭据。
export async function resolveSource(ctx, selection, identitySecret) {
    const { provider, model } = selection;
    if (!ctx.llm.listProviders().some((entry) => entry.id === provider)) return null;
    await ctx.llm.resolveModelInfo(provider, model);
    const entry = ctx.llm.listConfigurableProviders().find((item) => item.provider === provider);
    if (!entry) return null;
    let profile = ctx.settings.describe({ redactSecrets: true }).find((item) => item.ns === entry.settingsNs)?.value;
    for (const segment of entry.settingsPath) profile = profile?.[segment];
    if (!profile || typeof profile.baseURL !== 'string') return null;
    const base = new URL(profile.baseURL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) || base.username || base.password || base.search || base.hash) return null;
    let key;
    if (typeof profile.apiKeyEnv === 'string') key = (await ctx.credentials.resolve(profile.apiKeyEnv))?.value;
    else if (/^[a-z][a-z0-9-]*$/.test(provider)) {
        const record = await ctx.credentials.readRecord(`llm-pi-ai/${provider}`);
        if (record?.kind === 'api-key') key = record.key;
    }
    if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) return null;
    const path = base.pathname.replace(/\/+$/, '');
    base.pathname = path.endsWith('/v1') ? path : `${path}/v1`;
    const sourceId = createHmac('sha256', identitySecret).update(base.href).update('\0').update(key).digest('hex');
    return { sourceId, base, key };
}

async function queryJson(source, path, signal) {
    try {
        const url = new URL(source.base);
        url.pathname += path;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${source.key}`, Accept: 'application/json' }, redirect: 'error', signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
            await response.body?.cancel();
            return { status: [404, 405, 501].includes(response.status) || response.ok ? 'unsupported' : 'error', error: `查询接口返回 HTTP ${response.status}` };
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1_048_576) { await reader.cancel(); return { status: 'error', error: '查询结果过大' }; }
            text += decoder.decode(value, { stream: true });
        }
        const value = JSON.parse(text + decoder.decode());
        return value && typeof value === 'object' && !Array.isArray(value) ? { status: 'success', value } : { status: 'unsupported' };
    } catch {
        return { status: 'error', error: signal.aborted ? '查询超时或已取消' : '网络查询失败' };
    }
}

// 只返回白名单中的非凭据计费字段。
function fields(source, names) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const result = {};
    for (const field of names) {
        const value = source[field];
        if (finite(value) || typeof value === 'boolean' || value === null) result[field] = value;
        else if (typeof value === 'string') result[field] = value.slice(0, 200);
    }
    return Object.keys(result).length ? result : null;
}
const USAGE_FIELDS = ['requests', 'input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'total_tokens', 'cost', 'actual_cost', 'total_cost'];
function usageDetails(usage) {
    return {
        ...fields(usage, ['mode', 'status', 'planName', 'unit', 'expires_at', 'days_until_expiry', 'remaining']),
        quota: fields(usage.quota, ['limit', 'used', 'remaining', 'unit']),
        rateLimits: Array.isArray(usage.rate_limits) ? usage.rate_limits.slice(0, 10).map((item) => fields(item, ['window', 'limit', 'used', 'remaining', 'window_start', 'reset_at'])).filter(Boolean) : [],
        subscription: fields(usage.subscription, ['daily_usage_usd', 'weekly_usage_usd', 'monthly_usage_usd', 'daily_limit_usd', 'weekly_limit_usd', 'monthly_limit_usd', 'weekly_window_start', 'expires_at']),
        today: fields(usage.usage?.today, USAGE_FIELDS), total: fields(usage.usage?.total, USAGE_FIELDS),
        performance: fields(usage.usage, ['average_duration_ms', 'rpm', 'tpm']),
        dailyUsage: Array.isArray(usage.daily_usage) ? usage.daily_usage.slice(0, 90).map((item) => fields(item, ['date', ...USAGE_FIELDS])).filter(Boolean) : [],
        modelStats: Array.isArray(usage.model_stats) ? usage.model_stats.slice(0, 100).map((item) => fields(item, ['model', ...USAGE_FIELDS])).filter(Boolean) : []
    };
}

// 查询服务只返回结果，不保存快照、不缓存、不安排刷新。
export async function querySource(source, signal) {
    const [billingResult, usageResult] = await Promise.all([
        queryJson(source, '/sub2api/billing', signal), queryJson(source, '/usage', signal)
    ]);
    const billing = billingResult.value;
    const usage = usageResult.value;
    const billingKnown = billing?.object === 'sub2api.key_billing' && billing.billing_scope === 'token';
    const usageKnown = ['quota_limited', 'unrestricted'].includes(usage?.mode) && typeof usage.isValid === 'boolean'
        && (usage.quota || usage.rate_limits || usage.subscription || finite(usage.balance) || typeof usage.planName === 'string');
    const outcomes = {
        billing: billingResult.status === 'success' ? billingKnown ? 'success' : 'unsupported' : billingResult.status,
        usage: usageResult.status === 'success' ? usageKnown ? 'success' : 'unsupported' : usageResult.status
    };
    return {
        sourceId: source.sourceId, outcomes,
        error: [billingResult, usageResult].filter((item) => item.status === 'error').map((item) => item.error).join('；'),
        data: {
            ...UNKNOWN, identified: Boolean(billingKnown || usageKnown),
            multiplier: billingKnown && finite(billing.effective_rate_multiplier) && billing.effective_rate_multiplier >= 0 ? billing.effective_rate_multiplier : null,
            balance: usageKnown && finite(usage.balance) ? usage.balance : null,
            reason: !billingKnown && !usageKnown ? '当前 API 未识别为 Sub2API' : usageKnown && !finite(usage.balance) ? '当前 Key 返回额度或套餐信息，接口未提供钱包余额' : '',
            site: source.base.origin,
            billing: billingKnown ? fields(billing, ['group_rate_multiplier', 'user_rate_multiplier', 'resolved_rate_multiplier', 'effective_rate_multiplier', 'peak_rate_enabled', 'peak_start', 'peak_end', 'peak_rate_multiplier', 'applied_peak_multiplier', 'timezone', 'observed_at']) : null,
            usage: usageKnown ? usageDetails(usage) : null, updatedAt: Date.now()
        }
    };
}
