const React = require('react');
const { createPortal } = require('react-dom');
const { useAnchoredPosition, useDismissOnOutsidePointer } = require('@deepseek-ai/dsh-client-ui-primitives');
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

function DetailPanel({ value, provider, model, refresh, snapshot, visibilityOptions }) {
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
        h('div', { className: 'dsh-sub2api-footnote' }, `请求结束后等待 5 秒 · 10 秒超时${value.updatedAt ? ` · ${new Date(value.updatedAt).toLocaleTimeString()} 更新` : ''}`));
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
    const details = [value.identified ? 'Sub2API' : 'API 未知', value.site,
        provider && model ? `${provider} / ${model}` : null, value.reason, snapshot.error,
        value.updatedAt ? `上次成功更新 ${new Date(value.updatedAt).toLocaleTimeString()}` : null,
        '请求结束后等待 5 秒 · 10 秒超时 · 点击查看详情'].filter(Boolean).join('\n');
    return h('span', { ref: rootRef, className: 'dsh-sub2api-anchor' },
        h('button', { type: 'button', className: 'dsh-sub2api-status', title: details,
            'aria-label': `倍率 ${multiplier}，余额 ${balance}${staleLabel ? `，${staleLabel}` : ''}，查看详情`,
            'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? dialogId : undefined,
            'data-dsh-plugin': 'sub2api-status', onClick: () => setOpen((value) => !value)
        }, h('span', null, `倍率 ${multiplier}`), h('span', { 'aria-hidden': true, className: 'dsh-sub2api-status-separator' }, '·'),
        h('span', null, `余额 ${balance}`), staleLabel && h('span', { className: 'dsh-sub2api-stale' }, staleLabel)),
        open && createPortal(h('div', { id: dialogId, ref: panelRef, className: 'dsh-sub2api-panel', role: 'dialog',
            'aria-label': 'Sub2API 用量详情', style: pos ?? { visibility: 'hidden', left: 0, top: 0 }
        }, h(DetailPanel, { value, provider, model, refresh, snapshot, visibilityOptions })), document.body));
}

const css = '\n.dsh-sub2api-status{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;flex-shrink:0;max-width:100%;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));padding:1px 8px;border-radius:999px;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums}\n.dsh-sub2api-anchor{min-width:0;display:inline-flex}\n.dsh-sub2api-status:hover,.dsh-sub2api-status[aria-expanded=true]{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}\n.dsh-sub2api-status:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}\n.dsh-sub2api-status-separator{color:var(--dsw-alias-separator-primary);margin:0 6px}\n.dsh-sub2api-panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;position:fixed;display:flex;flex-direction:column}\n.dsh-sub2api-title{color:var(--dsw-alias-label-primary);display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:8px;font-weight:500}\n.dsh-sub2api-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}\n.dsh-sub2api-body{overflow-y:auto;min-height:0;max-height:min(480px,calc(100vh - 120px));overscroll-behavior:contain}\n.dsh-sub2api-section+.dsh-sub2api-section{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:10px}\n.dsh-sub2api-section-title{font-weight:500;margin-bottom:6px;color:var(--dsw-alias-label-secondary)}\n.dsh-sub2api-details{color:var(--dsw-alias-label-tertiary);display:grid;grid-template-columns:minmax(100px,auto) minmax(0,1fr);gap:6px 16px;margin:0}\n.dsh-sub2api-details dt,.dsh-sub2api-details dd{min-width:0;margin:0}\n.dsh-sub2api-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}\n.dsh-sub2api-refresh{font:inherit;color:var(--dsw-alias-label-tertiary);background:transparent;border:0;border-radius:var(--dsw-radius-sm);padding:2px 6px;cursor:pointer}\n.dsh-sub2api-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}\n.dsh-sub2api-footnote,.dsh-sub2api-note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:10px 0 0}\n.dsh-sub2api-series{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:10px}\n.dsh-sub2api-series summary{cursor:pointer;font-weight:500}\n.dsh-sub2api-series table{width:100%;border-collapse:collapse;margin-top:6px;font-variant-numeric:tabular-nums}\n.dsh-sub2api-series th,.dsh-sub2api-series td{padding:4px;text-align:right;border-bottom:.5px solid var(--dsw-alias-border-l2)}\n.dsh-sub2api-series th:first-child,.dsh-sub2api-series td:first-child{text-align:left;overflow-wrap:anywhere;max-width:180px}\n\n.dsh-sub2api-stale{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:4px}\n';
module.exports = { Status, css };
