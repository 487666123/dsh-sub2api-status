const { createDataCenter } = require('./data-center.cjs');
const { createRequestService } = require('./request-service.cjs');
const { createRefreshService } = require('./refresh-service.cjs');
const { Status, css } = require('./view.cjs');
const { installSettings } = require('./settings.cjs');

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
        style.textContent = css + '\n.dsh-sub2api-setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsh-sub2api-setting-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}[data-shortcut-modal="settings"] div:has(>[data-slot="settings.section"] .dsh-sub2api-settings){overflow:hidden}.dsh-sub2api-settings{height:100%;min-height:0;display:flex;flex-direction:column}.dsh-sub2api-settings>h2,.dsh-sub2api-settings>p{flex:none}.dsh-sub2api-settings>div{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr) auto;column-gap:16px}.dsh-sub2api-settings>div>p{grid-column:1/-1;grid-row:1}.dsh-sub2api-setting-fields{grid-column:1/-1;grid-row:2;min-height:0;overflow-y:auto;padding-right:8px;overscroll-behavior:contain}.dsh-sub2api-request-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:8px 20px;padding-bottom:16px;margin-bottom:8px;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsh-sub2api-settings .dsh-sub2api-request-fields>div{min-width:0;padding:8px 0;border-top:0}.dsh-sub2api-setting-reset{grid-row:3;justify-self:end;align-self:end;margin-top:16px}.dsh-sub2api-settings>div>div:last-child{grid-column:2;grid-row:3;display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;gap:8px}.dsh-sub2api-settings>div>div:last-child>button{box-sizing:border-box;min-width:88px;height:36px;padding:0 14px;font-size:14px;line-height:22px}.dsh-sub2api-settings>div>div:last-child>p{margin:0}';
        document.head.appendChild(style);
        return () => style.remove();
    });
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock', id: 'sub2api-status', order: 100,
        inject: (sessionId) => ({ ...refresh.bindSession(sessionId, ctx.modelDirectories.directoryFor(sessionId), ctx.sessions.subagentAddress(sessionId) === undefined), preferences: settings.preferences })
    }, Status));
}
module.exports = { name: 'sub2api-status-client', inject: ['slots', 'modelDirectories', 'sessions', 'remote', 'configForms'], apply };
