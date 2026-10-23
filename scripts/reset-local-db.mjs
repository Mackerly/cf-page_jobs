#!/usr/bin/env node
/**
 * 本地 D1 重置脚本（建表 + 写入种子数据）
 *
 * 为什么需要它：
 *   wrangler.toml 里没有声明 [[d1_databases]]（D1 绑定走 Pages 控制台），
 *   这时 `wrangler d1 execute` 会报 "Couldn't find a D1 DB with the name or binding"，
 *   而 `pages dev --d1=...` 会在 .wrangler/state 下自动建一个空的本地库。
 *   本脚本直接对这个 sqlite 文件执行 schema.sql / seed.sql。
 *
 * 用法：
 *   npm run db:reset:local            # 先建表，再写种子数据
 *   node --experimental-sqlite scripts/reset-local-db.mjs --schema-only
 *
 * 注意：先启动过一次 `npm run dev` 再执行，否则本地库文件还不存在。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D1_DIR = join(ROOT, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

if (!existsSync(D1_DIR)) {
  console.error(`找不到本地 D1 目录：${D1_DIR}`);
  console.error('请先运行一次 `npm run dev`（它会自动创建本地库），再执行本脚本。');
  process.exit(1);
}

const files = readdirSync(D1_DIR)
  .filter((f) => f.endsWith('.sqlite'))
  .map((f) => join(D1_DIR, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

if (!files.length) {
  console.error('本地 D1 目录里没有 .sqlite 文件，请先运行一次 `npm run dev`。');
  process.exit(1);
}

const target = files[0];
console.log(`目标库：${target}`);

const db = new DatabaseSync(target);
db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
console.log('已执行 schema.sql');

if (!process.argv.includes('--schema-only')) {
  db.exec(readFileSync(join(ROOT, 'seed.sql'), 'utf8'));
  console.log('已执行 seed.sql（会清空 recruit / users）');
}

const count = (t) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  } catch {
    return '表不存在';
  }
};

console.log(`recruit=${count('recruit')}  users=${count('users')}  audit=${count('audit')}`);
console.log('演示账号：admin / admin123');
db.close();
