/**
 * D1 数据访问层
 */
import { FIELD_NAMES, nowLocal } from './format';

export interface Env {
  DB: any;                       // D1Database
  SESSION_SECRET: string;
  SITE_NAME?: string;
  ALLOW_REGISTER?: string;
  PBKDF2_ITERATIONS?: string;
}

const LIKE_FIELDS = ['company_name', 'position', 'requirements', 'address', 'phone', 'salary'];

function whereClause(keyword: string, start = '', end = ''): { sql: string; args: string[] } {
  const conds: string[] = [];
  const args: string[] = [];

  const q = (keyword || '').trim();
  if (q) {
    conds.push('(' + LIKE_FIELDS.map((f) => `${f} LIKE ?`).join(' OR ') + ')');
    for (let i = 0; i < LIKE_FIELDS.length; i++) args.push(`%${q}%`);
  }
  // created_at 形如 2026-10-27 14:20:00，取前 10 位比较，纯日期或带时间都能命中
  if (start) { conds.push('substr(created_at, 1, 10) >= ?'); args.push(start); }
  if (end) { conds.push('substr(created_at, 1, 10) <= ?'); args.push(end); }

  return { sql: conds.length ? ' WHERE ' + conds.join(' AND ') : '', args };
}

// --------------------------------------------------------------------------- //
// 招聘信息
// --------------------------------------------------------------------------- //
export async function countRecruit(db: any, keyword = ''): Promise<number> {
  const { sql, args } = whereClause(keyword);
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM recruit${sql}`).bind(...args).first();
  return Number(row?.n ?? 0);
}

export async function listRecruit(db: any, keyword = '', page = 1, perPage = 15) {
  const { sql, args } = whereClause(keyword);
  const offset = (page - 1) * perPage;
  const res = await db
    .prepare(`SELECT * FROM recruit${sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...args, perPage, offset).all();
  return res.results ?? [];
}

export async function listAllRecruit(db: any, keyword = '', start = '', end = '') {
  const { sql, args } = whereClause(keyword, start, end);
  const res = await db.prepare(`SELECT * FROM recruit${sql} ORDER BY id ASC`).bind(...args).all();
  return res.results ?? [];
}

export async function getRecruit(db: any, id: number) {
  return db.prepare('SELECT * FROM recruit WHERE id = ?').bind(id).first();
}

/**
 * 按给定 id 批量取记录，返回顺序与传入的 ids 一致（勾选顺序 = Word 页面顺序）。
 * 已删除的 id 会被跳过。
 */
export async function getRecruitsByIds(db: any, ids: number[]) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const res = await db.prepare(`SELECT * FROM recruit WHERE id IN (${ph})`).bind(...ids).all();
  const byId = new Map<number, any>((res.results ?? []).map((r: any) => [Number(r.id), r]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as any[];
}

export async function insertRecruit(db: any, data: Record<string, string>): Promise<number> {
  const ts = nowLocal();
  const res = await db.prepare(
    `INSERT INTO recruit (company_name, position, headcount, requirements, salary, address, phone,
      created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(...FIELD_NAMES.map((k) => data[k] ?? ''), ts, ts).run();
  return Number(res.meta?.last_row_id ?? 0);
}

export async function insertManyRecruit(db: any, rows: Record<string, string>[]): Promise<number> {
  const ts = nowLocal();
  const stmts = rows.map((r) => db.prepare(
    `INSERT INTO recruit (company_name, position, headcount, requirements, salary, address, phone,
      created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(...FIELD_NAMES.map((k) => r[k] ?? ''), ts, ts));
  for (let i = 0; i < stmts.length; i += 50) {
    await db.batch(stmts.slice(i, i + 50));
  }
  return rows.length;
}

export async function updateRecruit(db: any, id: number, data: Record<string, string>) {
  await db.prepare(
    `UPDATE recruit SET company_name=?, position=?, headcount=?, requirements=?, salary=?,
      address=?, phone=?, updated_at=? WHERE id=?`,
  ).bind(...FIELD_NAMES.map((k) => data[k] ?? ''), nowLocal(), id).run();
}

export async function deleteRecruit(db: any, id: number) {
  await db.prepare('DELETE FROM recruit WHERE id = ?').bind(id).run();
}

// --------------------------------------------------------------------------- //
// 用户
// --------------------------------------------------------------------------- //
export interface UserRow {
  id: number;
  username: string;
  pwd_hash: string;
  salt: string;
  iterations: number;
  must_change: number;
  last_login: string;
  created_at: string;
  status: string;
  role: string;
  real_name: string;
  phone: string;
  remark: string;
  approved_at: string;
  approved_by: string;
  reg_ip: string;
}

export async function getUserById(db: any, id: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function getUserByName(db: any, username: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username.trim()).first();
}

export async function createUser(
  db: any,
  u: {
    username: string; hash: string; salt: string; iterations: number;
    role?: string; status?: string; mustChange?: number;
    realName?: string; phone?: string; remark?: string; regIp?: string;
  },
): Promise<number> {
  const ts = nowLocal();
  const active = (u.status ?? 'active') === 'active';
  const res = await db.prepare(
    `INSERT INTO users (username, pwd_hash, salt, iterations, must_change, created_at, status, role,
      real_name, phone, remark, approved_at, approved_by, reg_ip)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    u.username.trim(), u.hash, u.salt, u.iterations, u.mustChange ?? 0, ts,
    u.status ?? 'active', u.role ?? 'user',
    u.realName ?? '', u.phone ?? '', u.remark ?? '',
    active ? ts : '', active ? 'system' : '', u.regIp ?? '',
  ).run();
  return Number(res.meta?.last_row_id ?? 0);
}

export async function updatePassword(db: any, id: number, hash: string, salt: string, iterations: number, mustChange = 0) {
  await db.prepare('UPDATE users SET pwd_hash=?, salt=?, iterations=?, must_change=? WHERE id=?')
    .bind(hash, salt, iterations, mustChange, id).run();
}

export async function touchLogin(db: any, id: number) {
  await db.prepare('UPDATE users SET last_login=? WHERE id=?').bind(nowLocal(), id).run();
}

export async function listUsers(db: any): Promise<UserRow[]> {
  const res = await db.prepare(
    `SELECT * FROM users ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC`,
  ).all();
  return res.results ?? [];
}

export async function pendingCount(db: any): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE status='pending'").first();
  return Number(row?.n ?? 0);
}

export async function userCount(db: any): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  return Number(row?.n ?? 0);
}

export async function activeAdminCount(db: any): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE status='active' AND role='admin'",
  ).first();
  return Number(row?.n ?? 0);
}

export async function approveUser(db: any, id: number, operator: string) {
  await db.prepare("UPDATE users SET status='active', approved_at=?, approved_by=? WHERE id=?")
    .bind(nowLocal(), operator, id).run();
}

export async function setUserStatus(db: any, id: number, status: string) {
  await db.prepare('UPDATE users SET status=? WHERE id=?').bind(status, id).run();
}

export async function setUserRole(db: any, id: number, role: string) {
  await db.prepare('UPDATE users SET role=? WHERE id=?').bind(role, id).run();
}

export async function deleteUser(db: any, id: number) {
  await db.prepare('DELETE FROM users WHERE id=?').bind(id).run();
}

export async function countRecentRegistrations(db: any, ip: string, sinceText: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE reg_ip=? AND created_at>=?')
    .bind(ip, sinceText).first();
  return Number(row?.n ?? 0);
}

// --------------------------------------------------------------------------- //
// 登录失败限流
// --------------------------------------------------------------------------- //
export async function failCount(db: any, ip: string, username: string, windowSec: number): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const row = await db.prepare(
    'SELECT COUNT(*) AS n FROM login_fail WHERE ip=? AND username=? AND ts>=?',
  ).bind(ip, username.trim().toLowerCase(), since).first();
  return Number(row?.n ?? 0);
}

export async function noteFail(db: any, ip: string, username: string) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('INSERT INTO login_fail (ip, username, ts) VALUES (?,?,?)')
    .bind(ip, username.trim().toLowerCase(), now).run();
  // 顺手清理 1 天前的记录，避免表无限增长
  await db.prepare('DELETE FROM login_fail WHERE ts < ?').bind(now - 86400).run();
}

export async function clearFails(db: any, ip: string, username: string) {
  await db.prepare('DELETE FROM login_fail WHERE ip=? AND username=?')
    .bind(ip, username.trim().toLowerCase()).run();
}

// --------------------------------------------------------------------------- //
// 审计
// --------------------------------------------------------------------------- //
export async function writeAudit(
  db: any, username: string, action: string, detail: string, ip: string,
) {
  try {
    await db.prepare('INSERT INTO audit (ts, username, action, detail, ip) VALUES (?,?,?,?,?)')
      .bind(nowLocal(), username || '', action, String(detail).slice(0, 400), ip || '').run();
  } catch {
    /* 审计失败不影响主流程 */
  }
}

export async function listAudit(db: any, limit = 300) {
  const res = await db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').bind(limit).all();
  return res.results ?? [];
}
