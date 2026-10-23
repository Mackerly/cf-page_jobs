/**
 * 认证：PBKDF2 密码哈希、HMAC 签名会话、CSRF、Flash 消息
 * 全部基于 Web Crypto，无需任何第三方依赖。
 */
const enc = new TextEncoder();

export const SESSION_COOKIE = 'sid';
export const CSRF_COOKIE = '_c';
export const FLASH_COOKIE = '_f';
export const SESSION_TTL = 8 * 3600;      // 8 小时

export type CookieJar = string[];

// --------------------------------------------------------------------------- //
// 编码工具
// --------------------------------------------------------------------------- //
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(n = 16): string {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 供外部做常量时间比较（如初始化口令校验） */
export function safeEqualText(a: string, b: string): boolean {
  return safeEqual(a || '', b || '');
}

// --------------------------------------------------------------------------- //
// Cookie
// --------------------------------------------------------------------------- //
export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setCookie(
  jar: CookieJar, name: string, value: string,
  opts: { maxAge?: number; httpOnly?: boolean; path?: string } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`];
  parts.push(`Max-Age=${opts.maxAge ?? SESSION_TTL}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  jar.push(parts.join('; '));
}

export function deleteCookie(jar: CookieJar, name: string): void {
  jar.push(`${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

// --------------------------------------------------------------------------- //
// 密码
// --------------------------------------------------------------------------- //
export async function hashPassword(
  password: string, iterations: number,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256,
  );
  return { hash: hex(new Uint8Array(bits)), salt: hex(salt), iterations };
}

export async function verifyPassword(
  password: string, row: { pwd_hash: string; salt: string; iterations: number },
): Promise<boolean> {
  const salt = new Uint8Array((row.salt.match(/.{2}/g) || []).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: row.iterations || 100000, hash: 'SHA-256' }, key, 256,
  );
  return safeEqual(hex(new Uint8Array(bits)), row.pwd_hash);
}

const PWD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function randomPassword(len = 10): string {
  const out: string[] = [];
  const buf = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out.push(PWD_ALPHABET[buf[i] % PWD_ALPHABET.length]);
  return out.join('');
}

// --------------------------------------------------------------------------- //
// 会话（HMAC 签名 Cookie，无需服务端存储）
// --------------------------------------------------------------------------- //
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

export async function makeSession(secret: string, uid: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = `${uid}.${exp}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function readSession(req: Request, secret: string): Promise<number | null> {
  const raw = getCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!safeEqual(sig, await hmac(secret, `${uid}.${exp}`))) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  const n = Number(uid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// --------------------------------------------------------------------------- //
// CSRF（双提交 Cookie：随机 token 同时放 Cookie 与表单隐藏域）
// --------------------------------------------------------------------------- //
export function csrfToken(req: Request, jar: CookieJar): string {
  let token = getCookie(req, CSRF_COOKIE);
  if (!token || !/^[a-f0-9]{32,}$/.test(token)) {
    token = randomHex(24);
    setCookie(jar, CSRF_COOKIE, token, { maxAge: 12 * 3600 });
  }
  return token;
}

export function csrfOk(req: Request, form: FormData | URLSearchParams): boolean {
  const sent = String(form.get('_csrf') || '');
  const cookie = getCookie(req, CSRF_COOKIE) || '';
  return !!sent && !!cookie && safeEqual(sent, cookie);
}

// --------------------------------------------------------------------------- //
// Flash 消息（签名 Cookie，读后即清）
// --------------------------------------------------------------------------- //
export type FlashMsg = [string, string];   // [类别, 文本]

export async function readFlash(req: Request, secret: string): Promise<FlashMsg[]> {
  const raw = getCookie(req, FLASH_COOKIE);
  if (!raw) return [];
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return [];
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!safeEqual(sig, await hmac(secret, body))) return [];
  try {
    const arr = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return Array.isArray(arr) ? arr.filter((x) => Array.isArray(x) && x.length === 2) : [];
  } catch {
    return [];
  }
}

export async function pushFlash(
  req: Request, secret: string, jar: CookieJar, cat: string, msg: string,
): Promise<void> {
  const existing = await readFlash(req, secret);
  const all = [...existing, [cat, msg] as FlashMsg].slice(-3);
  const body = b64url(enc.encode(JSON.stringify(all)));
  setCookie(jar, FLASH_COOKIE, `${body}.${await hmac(secret, body)}`, { maxAge: 60 });
}

export function clearFlash(jar: CookieJar): void {
  deleteCookie(jar, FLASH_COOKIE);
}

// --------------------------------------------------------------------------- //
// 会话清理
// --------------------------------------------------------------------------- //
export function clearSession(jar: CookieJar): void {
  deleteCookie(jar, SESSION_COOKIE);
}

export function safeNext(target: string | null | undefined, fallback = '/'): string {
  if (!target) return fallback;
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return fallback;
  return target;
}
