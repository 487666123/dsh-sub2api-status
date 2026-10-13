import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本插件只使用静态 CommonJS 本地模块，打包为 DSH 要求的单个浏览器工厂。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
async function collect(path) {
    const absolute = resolve(root, path);
    const id = relative(root, absolute).replaceAll('\\', '/');
    if (modules.has(id)) return id;
    const source = await readFile(absolute, 'utf8');
    modules.set(id, '');
    if (id.endsWith('.json')) {
        modules.set(id, `module.exports = ${JSON.stringify(JSON.parse(source))};`);
        return id;
    }
    let output = source;
    const matches = [...source.matchAll(/require\((['"])(\.[^'"]+)\1\)/g)];
    for (const match of matches) {
        const dependency = await collect(relative(root, resolve(dirname(absolute), match[2])));
        output = output.replace(match[0], `require(${JSON.stringify(dependency)})`);
    }
    modules.set(id, output);
    return id;
}
const entry = await collect('src/client/entry.cjs');
const factories = [...modules].map(([id, source]) => `${JSON.stringify(id)}: (module, exports, require) => {\n${source}\n}`).join(',\n');
const bundle = `window.__ModuleLoader__.load({\n    id: 'dsh-sub2api-status',\n    factory: (platformRequire) => {\n        const factories = {\n${factories}\n        };\n        const cache = new Map();\n        function require(id) {\n            if (!Object.prototype.hasOwnProperty.call(factories, id)) return platformRequire(id);\n            if (cache.has(id)) return cache.get(id).exports;\n            const module = { exports: {} };\n            cache.set(id, module);\n            factories[id](module, module.exports, require);\n            return module.exports;\n        }\n        return require(${JSON.stringify(entry)});\n    }\n});\n`;
await writeFile(resolve(root, 'client.js'), bundle, 'utf8');
console.log(`Built client.js from ${modules.size} modules`);
