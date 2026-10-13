import { randomBytes } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import displayOptions from '../display-options.json' with { type: 'json' };
import { resolveSource, querySource } from './request-service.mjs';

export const Config = z.object(Object.fromEntries(displayOptions.map((option) => [option.key, z.boolean().default(option.default).volatile()])));

export const name = 'sub2api-status';
export const inject = ['webServer', 'connection', 'llm', 'settings', 'credentials'];

// 宿主适配层只提供经过认证的请求入口和资源释放，不保存查询数据。
export function apply(ctx) {
    ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
    const identitySecret = randomBytes(32);
    const controllers = new Set();
    ctx.effect(() => () => {
        for (const controller of controllers) controller.abort();
        controllers.clear();
    });
    for (const operation of ['route', 'status']) ctx.effect(() => ctx.webServer.register({
        kind: 'exact', path: `/plugins/dsh-sub2api-status/${operation}`,
        async handler(request, response) {
            const send = (status, value) => {
                if (response.destroyed) return;
                response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                response.end(JSON.stringify(value));
            };
            const rejection = ctx.connection.requestRejection(request);
            if (rejection !== undefined) return send(rejection, { reason: '请求未经授权' });
            if (request.method !== 'GET') return send(405, { reason: '只支持 GET 查询' });
            const peer = request.socket?.remoteAddress;
            if (peer && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return send(403, { reason: '仅支持本机访问' });
            if (request.headers['sec-fetch-site'] === 'cross-site') return send(403, { reason: '不支持跨站访问' });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);
            const closed = () => { if (!response.writableEnded) controller.abort(); };
            response.on('close', closed);
            controllers.add(controller);
            try {
                const params = new URL(request.url, 'http://localhost').searchParams;
                const provider = params.get('provider');
                const model = params.get('model');
                if (!provider || !model || provider.length > 200 || model.length > 300) return send(400, { reason: '模型参数无效' });
                const source = await resolveSource(ctx, { provider, model }, identitySecret);
                if (controller.signal.aborted) return send(504, { reason: '查询超时' });
                if (!source) return send(operation === 'route' ? 200 : 409, { sourceId: null, reason: '当前模型没有可查询的 API 站点或 API Key' });
                if (operation === 'route') return send(200, { sourceId: source.sourceId, site: source.base.origin });
                const expected = params.get('sourceId');
                if (expected && expected !== source.sourceId) return send(409, { reason: '当前 API 配置已变更' });
                return send(200, await querySource(source, controller.signal));
            } catch {
                return send(controller.signal.aborted ? 504 : 502, { reason: controller.signal.aborted ? '查询超时' : '宿主查询不可用' });
            } finally {
                clearTimeout(timeout);
                controllers.delete(controller);
                response.off('close', closed);
            }
        }
    }));
}
