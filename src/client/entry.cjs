const { createDataCenter } = require('./data-center.cjs');
const { createRequestService } = require('./request-service.cjs');
const { createRefreshService } = require('./refresh-service.cjs');
const { Status, css } = require('./view.cjs');
const { installDisplaySettings } = require('./settings.cjs');

function apply(ctx) {
    const center = createDataCenter();
    const settings = installDisplaySettings(ctx);
    const refresh = createRefreshService({ requests: createRequestService(), center });
    ctx.effect(() => () => { refresh.dispose(); center.clear(); settings.dispose(); });
    ctx.effect(() => {
        const disposers = ['settings/document-updated', 'credentials/reference-updated', 'credentials/record-updated', 'llm/adapters-updated'].map((event) => ctx.remote.$on(event, () => refresh.invalidate()));
        return () => { for (const dispose of disposers) dispose(); };
    });
    ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = 'dsh-sub2api-status';
        style.textContent = css + '\n.dsh-sub2api-setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsh-sub2api-setting-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}';
        document.head.appendChild(style);
        return () => style.remove();
    });
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock', id: 'sub2api-status', order: 100,
        inject: (sessionId) => ({ ...refresh.bindSession(sessionId, ctx.modelDirectories.directoryFor(sessionId), ctx.sessions.subagentAddress(sessionId) === undefined), preferences: settings.preferences })
    }, Status));
}
module.exports = { name: 'sub2api-status-client', inject: ['slots', 'modelDirectories', 'sessions', 'remote', 'configForms'], apply };
