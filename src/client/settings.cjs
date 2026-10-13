const React = require('react');
const { SettingsForm, SettingsFormModel, Switch, Button } = require('@deepseek-ai/dsh-client-ui-primitives');
const options = require('../display-options.json');
const h = React.createElement;
const description = '选择 Sub2API 详情窗显示的数据。保存后立即生效；底部倍率与余额读数保持显示。';

function SettingsPage({ view, controller }) {
    const state = React.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot, controller.store.getSnapshot);
    if (view === 'summary') return description;
    return h(SettingsForm, {
        state,
        labels: { unavailable: 'Sub2API 插件设置暂不可用', readOnly: '当前设置为只读', saveFailed: '保存失败，请重试', save: '保存', saving: '保存中…' },
        onSave: controller.actions.save, onDiscard: controller.actions.discard
    }, options.map((option) => h('div', { key: option.key, className: 'dsh-sub2api-setting-row' },
        h('div', { className: 'dsh-sub2api-setting-label' }, option.label),
        h(Switch, { checked: state.fields[option.key].text === 'true', label: option.label, disabled: !state.writable || state.saving,
            onChange: (checked) => controller.actions.edit(option.key, String(checked)) }))),
        h(Button, { variant: 'secondary', disabled: !state.writable || state.saving,
            onClick: () => options.forEach((option) => controller.actions.resetField(option.key)) }, '恢复默认显示项'));
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
        const ns = row?.ns;
        if (ns === currentNs) return;
        pageOff?.();
        form?.dispose();
        currentNs = ns;
        if (!ns) return;
        const scope = ctx.configForms.get(ns);
        scopes.set(ns, scope);
        form = new SettingsFormModel(scope, options.map((option) => ({
            field: option.key,
            format: (value) => String(typeof value === 'boolean' ? value : option.default),
            parse: (text) => text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined
        })));
        const owned = form;
        const controller = {
            store: owned.bind(() => ({ ...owned.shell(), fields: Object.fromEntries(options.map((option) => [option.key, owned.field(option.key)])) })),
            actions: owned.actions()
        };
        pageOff = ctx.slots.inject('plugins.item', () => ctx.slots.register({
            name: 'plugins.item', id: 'sub2api-status-settings', order: 50, label: () => 'Sub2API 数据显示',
            inject: () => ({ controller })
        }, SettingsPage));
    }
    const mirrorOff = mirror.subscribe(synchronize);
    mirror.ensure();
    synchronize();
    return { preferences, dispose: () => { mirrorOff(); pageOff?.(); form?.dispose(); } };
}
module.exports = { installDisplaySettings };
