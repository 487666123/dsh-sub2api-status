const React = require('react');
const { SettingsForm, SettingsFormModel, SettingsValueField, Switch, Button } = require('@deepseek-ai/dsh-client-ui-primitives');
const options = require('../display-options.json');
const requestOptions = require('../request-options.json');
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

function installDisplaySettings(ctx) {
    const mirror = ctx.configForms.describe();
    const scopes = new Map();
    let pageOff;
    let currentNs;
    let form;
    const preferences = {
        getSnapshot: () => currentNs ? scopes.get(currentNs).getSnapshot() : mirror.getSnapshot(),
        subscribe(listener) {
            let off;
            const sync = () => {
                off?.();
                const scope = currentNs && scopes.get(currentNs);
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
        if (!ns) return;
        const scope = ctx.configForms.get(ns);
        scopes.set(ns, scope);
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
module.exports = { installDisplaySettings };
