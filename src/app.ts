/**
 * 招聘信息管理系统 · Cloudflare Pages 版（Pages Functions）
 *
 * 与 Worker 版的唯一区别：入口是 functions/[[path]].ts 里的 onRequest，
 * 它把 request / env 交给这里的 handleRequest()，其余逻辑完全一致。
 *
 * 路由：
 *   公开：/  /preview/:id  /docx/:id  /qr.jpg  /login  /register
 *   需登录：/add /edit/:id /delete/:id /import /export/excel /docx/zip /docx/range
 *           /docx/selected /wechat/selected /live /template.xlsx /password
 *   需管理员：/users /users/:id/action /audit /backup.sql
 */
import { zipSync } from 'fflate';
import * as auth from './auth';
import * as db from './db';
import * as pages from './html';
import { buildDocx, buildDocxMulti, qrBytes } from './docx';
import { exportXlsx, buildTemplate } from './xlsx';
import { parseImport } from './xlsx-import';
import { FIELD_NAMES, STATUS_LABELS, dateRange, docFilename, effStatus, multiDocFilename, normStatus,
  nowLocal, prepare, rangeDocFilename, rangeLabel, rangeXlsxFilename, todayIso,
  toIsoDate } from './format';
import { buildWechatVariants, WECHAT_THEMES } from './wechat';
import { CSS } from './css';

const PER_PAGE = 15;
const MAX_FAILS = 5;
const LOCK_WINDOW = 300;          // 秒
const MAX_REG_PER_HOUR = 5;
const MAX_SELECTED = 200;         // 单次「导出选定为 Word」最大条数
const MAX_RANGE = 300;            // 单次「按日期导出 Word」最大条数
const MAX_WECHAT = 30;            // 单次「复制微信发布」最大条数（一篇推文不宜过长）
const MAX_LIVE = 30;              // 单次「直播轮播」最大条数
const LIVE_INTERVALS = [3, 5, 8, 10, 15, 20, 30, 45, 60];   // 直播页可选的切换间隔（秒）
const LIVE_DEFAULT_INTERVAL = 8;
const PER_CHOICES = [15, 30, 50, 100];   // 列表页可选的每页条数
const DEFAULT_SITE_NAME = '招聘信息管理系统';   // SITE_NAME 未配置时的默认站名
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface Ctx {
  req: Request;
  env: db.Env;
  url: URL;
  jar: string[];
  user: db.UserRow | null;
  isAdmin: boolean;
  pending: number;
  csrf: string;
  allowRegister: boolean;
  flashes: [string, string][];
  ip: string;
  secret: string;
}

// --------------------------------------------------------------------------- //
// 响应工具
// --------------------------------------------------------------------------- //
function withCookies(res: Response, jar: string[]): Response {
  for (const c of jar) res.headers.append('Set-Cookie', c);
  return res;
}

function htmlRes(c: Ctx, body: string, status = 200): Response {
  // 页面已经把 flash 渲染出来了，清掉 cookie，避免下次请求重复显示
  auth.clearFlash(c.jar);
  return withCookies(new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
    },
  }), c.jar);
}

function redirect(c: Ctx, location: string): Response {
  return withCookies(new Response(null, {
    status: 302, headers: { Location: location, 'Cache-Control': 'no-store' },
  }), c.jar);
}

function fileRes(c: Ctx, bytes: Uint8Array, filename: string, mime: string): Response {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return withCookies(new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
    },
  }), c.jar);
}

function layoutOpts(c: Ctx, title: string, active?: string): pages.LayoutOpts {
  // SITE_NAME 在 Pages 控制台的 Variables and Secrets 里配置，页面标题、页头、页脚同步替换
  const siteName = String(c.env.SITE_NAME || '').trim() || DEFAULT_SITE_NAME;
  return {
    title: title.split(DEFAULT_SITE_NAME).join(siteName),
    siteName,
    csrf: c.csrf, user: c.user, isAdmin: c.isAdmin,
    pendingCount: c.pending, allowRegister: c.allowRegister,
    flashes: c.flashes, active, maxWechat: MAX_WECHAT, maxLive: MAX_LIVE,
  };
}

async function flash(c: Ctx, cat: string, msg: string): Promise<void> {
  c.flashes.push([cat, msg]);
  await auth.pushFlash(c.req, c.secret, c.jar, cat, msg);
}

async function audit(c: Ctx, action: string, detail: string): Promise<void> {
  await db.writeAudit(c.env.DB, c.user?.username ?? '', action, detail, c.ip);
}

function badRequest(c: Ctx, msg: string): Response {
  return htmlRes(c, pages.errorPage(layoutOpts(c, '请求无效'), 400, msg,
    '可能是页面停留时间过长导致表单失效，请刷新页面后重新提交。'), 400);
}

// --------------------------------------------------------------------------- //
// 主入口（由 functions/[[path]].ts 调用）
// --------------------------------------------------------------------------- //
export async function handleRequest(req: Request, env: db.Env): Promise<Response> {
  const url = new URL(req.url);
  const jar: string[] = [];
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'local';

  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    return new Response(
      [
        '部署缺少 SESSION_SECRET（至少 16 个字符）。',
        '',
        'Cloudflare 控制台 → Workers & Pages → 本项目 → Settings → Variables and Secrets',
        '→ Add → 类型选 Secret，变量名 SESSION_SECRET，值填 openssl rand -hex 32 的输出，',
        'Production 和 Preview 两个环境都要加，然后 Redeploy 一次。',
        '',
        '本地开发：写进 .dev.vars（参考 .dev.vars.example）。',
      ].join('\n'),
      { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  const c: Ctx = {
    req, env, url, jar,
    user: null, isAdmin: false, pending: 0,
    csrf: '', allowRegister: (env.ALLOW_REGISTER ?? 'true') !== 'false',
    flashes: [], ip, secret,
  };

  // 会话
  const uid = await auth.readSession(req, secret);
  if (uid) {
    const u = await db.getUserById(env.DB, uid);
    if (u && u.status === 'active') {
      c.user = u;
      c.isAdmin = u.role === 'admin';
      if (c.isAdmin) c.pending = await db.pendingCount(env.DB);
    } else {
      auth.clearSession(jar);
    }
  }

  c.csrf = auth.csrfToken(req, jar);
  c.flashes = await auth.readFlash(req, secret);

  try {
    return await route(c);
  } catch (err: any) {
    console.error('pages function error:', err?.stack || err);
    return htmlRes(c, pages.errorPage(layoutOpts(c, '服务器错误'), 500, '服务器内部错误',
      '请稍后重试；若持续出现，请查看 Cloudflare 实时日志（wrangler pages deployment tail）。'), 500);
  }
}

async function route(c: Ctx): Promise<Response> {
  const { pathname } = c.url;
  const method = c.req.method;

  // ---- 静态资源 ----
  if (pathname === '/static/style.css') {
    return withCookies(new Response(CSS, {
      headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    }), c.jar);
  }
  if (pathname === '/favicon.ico') return new Response(null, { status: 204 });
  if (pathname === '/health') return new Response('ok');

  // ---- 表单解析 + CSRF ----
  let form: FormData | null = null;
  if (method === 'POST') {
    try {
      form = await c.req.formData();
    } catch {
      return badRequest(c, '无法解析提交的表单数据');
    }
    if (!auth.csrfOk(c.req, form)) {
      return badRequest(c, '表单校验失败（CSRF），请刷新页面后重试');
    }
  }

  // ---- 初始密码强制修改 ----
  const exempt = ['/password', '/logout', '/login', '/register', '/static/style.css'];
  if (c.user && c.user.must_change && !exempt.includes(pathname)) {
    await flash(c, 'error', '当前仍在使用初始密码，请先修改密码后再进行数据操作');
    return redirect(c, '/password');
  }

  // ---- 公开路由 ----
  if (pathname === '/') return handleIndex(c);
  if (pathname === '/setup') return handleSetup(c, form);

  if (pathname === '/login') {
    if (c.user) return redirect(c, '/');
    return method === 'POST' ? handleLoginPost(c, form!) : handleLoginGet(c);
  }
  if (pathname === '/register') {
    if (c.user) return redirect(c, '/');
    if (!c.allowRegister) {
      await flash(c, 'error', '系统当前未开放自助注册，请联系管理员开通账号');
      return redirect(c, '/login');
    }
    return method === 'POST' ? handleRegisterPost(c, form!) : handleRegisterGet(c);
  }
  if (pathname === '/logout' && method === 'POST') {
    await audit(c, '退出', `用户 ${c.user?.username ?? ''} 退出登录`);
    auth.clearSession(c.jar);
    await flash(c, 'success', '已安全退出登录');
    return redirect(c, '/');
  }

  const mPreview = /^\/preview\/(\d+)$/.exec(pathname);
  if (mPreview && method === 'GET') return handlePreview(c, Number(mPreview[1]));

  const mDocx = /^\/docx\/(\d+)$/.exec(pathname);
  if (mDocx && method === 'GET') return handleDocx(c, Number(mDocx[1]));

  if (pathname === '/qr.jpg') {
    return withCookies(new Response(qrBytes() as unknown as BodyInit, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    }), c.jar);
  }

  // ---- 需要登录 ----
  const needLogin = [
    '/add', '/import', '/export/excel', '/docx/zip', '/docx/range', '/docx/selected',
    '/wechat/selected', '/live', '/template.xlsx', '/password', '/backup.sql',
  ];
  const isProtected = needLogin.includes(pathname)
    || /^\/edit\/\d+$/.test(pathname) || /^\/delete\/\d+$/.test(pathname)
    || pathname === '/users' || /^\/users\/\d+\/action$/.test(pathname) || pathname === '/audit';

  if (isProtected && !c.user) {
    await flash(c, 'error', '该功能需要登录后才能使用，请先登录');
    const next = c.url.pathname + (c.url.search || '');
    return redirect(c, `/login?next=${encodeURIComponent(next)}`);
  }

  if (pathname === '/add') {
    return method === 'POST' ? handleAddPost(c, form!) : handleAddGet(c);
  }

  const mEdit = /^\/edit\/(\d+)$/.exec(pathname);
  if (mEdit) {
    return method === 'POST' ? handleEditPost(c, form!, Number(mEdit[1])) : handleEditGet(c, Number(mEdit[1]));
  }

  const mDelete = /^\/delete\/(\d+)$/.exec(pathname);
  if (mDelete && method === 'POST') return handleDelete(c, form!, Number(mDelete[1]));

  if (pathname === '/import') {
    return method === 'POST' ? handleImportPost(c, form!) : handleImportGet(c);
  }
  if (pathname === '/export/excel') return handleExport(c);
  if (pathname === '/template.xlsx') return handleTemplate(c);
  if (pathname === '/docx/zip') return handleZip(c);
  if (pathname === '/docx/range') return handleDocxRange(c);
  if (pathname === '/docx/selected') {
    return method === 'POST' ? handleDocxSelected(c, form!) : redirect(c, '/');
  }
  if (pathname === '/wechat/selected') {
    return method === 'POST' ? handleWechatSelected(c, form!) : redirect(c, '/');
  }
  if (pathname === '/live') {
    return handleLive(c, method === 'POST' ? form! : null);
  }
  if (pathname === '/backup.sql') return handleBackup(c);

  if (pathname === '/password') {
    return method === 'POST' ? handlePasswordPost(c, form!) : handlePasswordGet(c);
  }

  if (pathname === '/users') {
    if (!c.isAdmin) { await flash(c, 'error', '只有管理员才能访问该页面'); return redirect(c, '/'); }
    return handleUsers(c);
  }
  const mUserAction = /^\/users\/(\d+)\/action$/.exec(pathname);
  if (mUserAction && method === 'POST') {
    if (!c.isAdmin) { await flash(c, 'error', '只有管理员才能访问该页面'); return redirect(c, '/'); }
    return handleUserAction(c, form!, Number(mUserAction[1]));
  }
  if (pathname === '/audit') {
    if (!c.isAdmin) { await flash(c, 'error', '只有管理员才能访问该页面'); return redirect(c, '/'); }
    const rows = await db.listAudit(c.env.DB, 300);
    return htmlRes(c, pages.auditPage({ ...layoutOpts(c, '操作日志', 'audit'), rows }));
  }

  return htmlRes(c, pages.errorPage(layoutOpts(c, '页面不存在'), 404,
    '页面或记录不存在', '该招聘信息可能已被删除，请返回列表查看。', '🔍'), 404);
}

// --------------------------------------------------------------------------- //
// 首次初始化：创建第一个管理员
// --------------------------------------------------------------------------- //
async function handleSetup(c: Ctx, form: FormData | null): Promise<Response> {
  const expected = (c.env as any).SETUP_TOKEN as string | undefined;
  const given = String(c.url.searchParams.get('token')
    || (form ? form.get('token') : '')
    || '');

  if (!expected) {
    return htmlRes(c, pages.errorPage(layoutOpts(c, '未配置初始化口令'), 403,
      '站点尚未配置初始化口令',
      '请到 Cloudflare 控制台 → 本项目 → Settings → Variables and Secrets 添加 SETUP_TOKEN（Secret 类型），'
      + '重新部署后再用 /setup?token=你的口令 访问本页；本地开发则写进 .dev.vars。',
      '🔧'), 403);
  }
  if (!auth.safeEqualText(given, expected)) {
    return htmlRes(c, pages.errorPage(layoutOpts(c, '口令不正确'), 403,
      '初始化口令不正确', '请检查地址栏中的 token 是否与环境变量 SETUP_TOKEN 一致。', '🔒'), 403);
  }

  const users = await db.userCount(c.env.DB);
  if (users > 0) {
    return htmlRes(c, pages.errorPage(layoutOpts(c, '已完成初始化'), 404,
      '系统已完成初始化', '数据库中已存在账号，初始化页面已自动失效，请直接登录。', '✅'), 404);
  }

  if (!form) {
    return htmlRes(c, pages.setupPage(
      { ...layoutOpts(c, '初始化 · 招聘信息管理系统'), allowRegister: false }, given, {},
    ));
  }

  const username = String(form.get('username') || '').trim();
  const pwd = String(form.get('password') || '');
  const again = String(form.get('confirm_password') || '');
  let error = '';
  if (username.length < 3) error = '账号至少 3 个字符';
  else if (!/^[A-Za-z0-9_-]+$/.test(username)) error = '账号只能包含字母、数字、下划线和短横线';
  else if (pwd.length < 8) error = '密码至少 8 位';
  else if (pwd !== again) error = '两次输入的密码不一致';

  if (error) {
    return htmlRes(c, pages.setupPage(
      { ...layoutOpts(c, '初始化 · 招聘信息管理系统'), allowRegister: false },
      given, { username }, error,
    ), 400);
  }

  const iterations = Number(c.env.PBKDF2_ITERATIONS || 100000);
  const { hash, salt } = await auth.hashPassword(pwd, iterations);
  await db.createUser(c.env.DB, {
    username, hash, salt, iterations, role: 'admin', status: 'active', mustChange: 0,
  });
  await db.writeAudit(c.env.DB, username, '初始化', `创建管理员账号 ${username}`, c.ip);
  await flash(c, 'success', '管理员账号已创建，请用该账号登录');
  return redirect(c, '/login');
}

// --------------------------------------------------------------------------- //
// 列表
// --------------------------------------------------------------------------- //
async function handleIndex(c: Ctx): Promise<Response> {
  const q = (c.url.searchParams.get('q') || '').trim();
  // 日期区间同时作用于列表与导出；留空表示不限
  const { start, end } = dateRange(c.url.searchParams.get('start'), c.url.searchParams.get('end'));
  // 招聘状态开关：默认只显示「招聘中」，已招满 / 已失效按需勾选
  const showFull = c.url.searchParams.get('show_full') === '1';
  const showExpired = c.url.searchParams.get('show_expired') === '1';
  const today = todayIso();
  const perReq = Number(c.url.searchParams.get('per') || 0);
  const per = PER_CHOICES.includes(perReq) ? perReq : PER_PAGE;
  const pageReq = Math.max(1, Number(c.url.searchParams.get('page') || 1) || 1);
  const total = await db.countRecruit(c.env.DB, q, start, end, showFull, showExpired, today);
  const pagesTotal = Math.max(1, Math.ceil(total / per));
  const page = Math.min(pageReq, pagesTotal);
  const rows = await db.listRecruit(c.env.DB, q, page, per, start, end, showFull, showExpired, today);
  // 未勾选时，告诉用户被藏了多少条，避免以为数据丢了
  const byStatus = await db.countByStatus(c.env.DB, q, start, end, today);

  // 页码窗口：当前页前后各 2 页
  const pageNums: number[] = [];
  for (let n = Math.max(1, page - 2); n <= Math.min(pagesTotal, page + 2); n++) pageNums.push(n);

  return htmlRes(c, pages.indexPage({
    ...layoutOpts(c, '招聘列表 · 招聘信息管理系统', 'index'),
    rows, q, page, pages: pagesTotal, total,
    per, perChoices: PER_CHOICES, pageNums, start, end,
    filtered: !!(q || start || end || showFull || showExpired),
    showFull, showExpired,
    hiddenFull: showFull ? 0 : byStatus.full,
    hiddenExpired: showExpired ? 0 : byStatus.expired,
  }));
}

// --------------------------------------------------------------------------- //
// 登录
// --------------------------------------------------------------------------- //
function handleLoginGet(c: Ctx): Response {
  const nextUrl = auth.safeNext(c.url.searchParams.get('next'));
  return htmlRes(c, pages.loginPage({ ...layoutOpts(c, '登录 · 招聘信息管理系统'), nextUrl, username: '' }));
}

async function handleLoginPost(c: Ctx, form: FormData): Promise<Response> {
  const nextUrl = auth.safeNext(String(form.get('next') || '/'));
  const username = String(form.get('username') || '').trim();
  const password = String(form.get('password') || '');
  const render = (status: number) => htmlRes(c, pages.loginPage({
    ...layoutOpts(c, '登录 · 招聘信息管理系统'), nextUrl, username,
  }), status);

  const fails = await db.failCount(c.env.DB, c.ip, username, LOCK_WINDOW);
  if (fails >= MAX_FAILS) {
    await flash(c, 'error', `密码错误次数过多，请 ${Math.ceil(LOCK_WINDOW / 60)} 分钟后再试`);
    return render(429);
  }

  const row = await db.getUserByName(c.env.DB, username);
  const ok = row ? await auth.verifyPassword(password, row) : false;

  if (!row || !ok) {
    if (row) await db.noteFail(c.env.DB, c.ip, username);
    const left = Math.max(0, MAX_FAILS - (fails + (row ? 1 : 0)));
    await flash(c, 'error', left > 0
      ? `账号或密码不正确，还可尝试 ${left} 次`
      : '账号或密码不正确，已暂时锁定');
    return render(401);
  }

  if (row.status === 'pending') {
    await flash(c, 'warn', '账号正在等待管理员审批，审批通过后即可登录使用');
    return render(403);
  }
  if (row.status !== 'active') {
    await flash(c, 'error', '该账号已被停用，请联系管理员');
    return render(403);
  }

  await db.clearFails(c.env.DB, c.ip, username);
  await db.touchLogin(c.env.DB, row.id);
  auth.clearSession(c.jar);
  auth.setCookie(c.jar, auth.SESSION_COOKIE, await auth.makeSession(c.secret, row.id));
  await db.writeAudit(c.env.DB, row.username, '登录', `用户 ${row.username} 登录成功`, c.ip);

  if (row.must_change) {
    await flash(c, 'error', '登录成功，但当前使用的是初始密码，请立即修改');
    return redirect(c, '/password');
  }
  await flash(c, 'success', `登录成功，欢迎回来：${row.username}`);
  return redirect(c, nextUrl);
}

// --------------------------------------------------------------------------- //
// 注册
// --------------------------------------------------------------------------- //
function handleRegisterGet(c: Ctx): Response {
  const form = { username: '', real_name: '', phone: '', remark: '' };
  return htmlRes(c, pages.registerPage({ ...layoutOpts(c, '注册申请 · 招聘信息管理系统'), form }));
}

async function handleRegisterPost(c: Ctx, form: FormData): Promise<Response> {
  const f = {
    username: String(form.get('username') || '').trim(),
    real_name: String(form.get('real_name') || '').trim(),
    phone: String(form.get('phone') || '').trim(),
    remark: String(form.get('remark') || '').trim(),
  };
  const pwd = String(form.get('password') || '');
  const pwd2 = String(form.get('confirm_password') || '');
  const render = (status: number) => htmlRes(c, pages.registerPage({
    ...layoutOpts(c, '注册申请 · 招聘信息管理系统'), form: f,
  }), status);

  const since = nowLocal(new Date(Date.now() - 3600_000));
  if ((await db.countRecentRegistrations(c.env.DB, c.ip, since)) >= MAX_REG_PER_HOUR) {
    await flash(c, 'error', '同一网络注册过于频繁，请 1 小时后再试');
    return render(429);
  }

  let error = '';
  if (f.username.length < 3) error = '用户名至少 3 个字符';
  else if (f.username.length > 30) error = '用户名不能超过 30 个字符';
  else if (!/^[A-Za-z0-9_-]+$/.test(f.username)) error = '用户名只能包含字母、数字、下划线和短横线';
  else if (await db.getUserByName(c.env.DB, f.username)) error = '该用户名已被占用，请换一个';
  else if (pwd.length < 6) error = '密码至少 6 位';
  else if (pwd !== pwd2) error = '两次输入的密码不一致';
  else if (!f.real_name) error = '请填写真实姓名，便于管理员核对身份';
  else if (!f.phone) error = '请填写联系电话，便于管理员联系确认';

  if (error) {
    await flash(c, 'error', error);
    return render(400);
  }

  const iterations = Number(c.env.PBKDF2_ITERATIONS || 100000);
  const { hash, salt } = await auth.hashPassword(pwd, iterations);
  await db.createUser(c.env.DB, {
    username: f.username, hash, salt, iterations,
    role: 'user', status: 'pending', mustChange: 0,
    realName: f.real_name, phone: f.phone, remark: f.remark, regIp: c.ip,
  });
  await db.writeAudit(c.env.DB, '', '注册申请',
    `${f.username}（${f.real_name}）提交注册申请`, c.ip);
  await flash(c, 'success', '注册申请已提交，请等待管理员审批；审批通过后即可用该账号登录');
  return redirect(c, '/login');
}

// --------------------------------------------------------------------------- //
// 新增 / 编辑 / 删除
// --------------------------------------------------------------------------- //
function formDataToRecord(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FIELD_NAMES) out[k] = String(form.get(k) ?? '').trim();
  // 发布日期留空 = 当天；格式不对留给调用方报错
  out.publish_date = out.publish_date || todayIso();
  // 招聘状态留空 / 认不出 = 招聘中（是否自动失效由展示时按发布日期算）
  out.status = normStatus(out.status);
  return out;
}

/** 校验并规范化发布日期，返回错误信息（空串 = 通过） */
function fixPublishDate(data: Record<string, string>): string {
  const fixed = toIsoDate(data.publish_date);
  if (!fixed) return '发布日期格式不正确，请重新选择';
  data.publish_date = fixed;
  return '';
}

function handleAddGet(c: Ctx): Response {
  const rec: Record<string, string> = {};
  for (const k of FIELD_NAMES) rec[k] = '';
  rec.publish_date = todayIso();
  return htmlRes(c, pages.formPage({ ...layoutOpts(c, '新增招聘信息', 'add'), mode: 'add', rec }));
}

async function handleAddPost(c: Ctx, form: FormData): Promise<Response> {
  const data = formDataToRecord(form);
  const dateErr = fixPublishDate(data);
  if (dateErr) {
    await flash(c, 'error', dateErr);
    return htmlRes(c, pages.formPage({
      ...layoutOpts(c, '新增招聘信息', 'add'), mode: 'add', rec: data,
    }), 400);
  }
  if (!data.company_name || !data.position) {
    await flash(c, 'error', '用人单位名称、招聘岗位为必填项');
    return htmlRes(c, pages.formPage({
      ...layoutOpts(c, '新增招聘信息', 'add'), mode: 'add', rec: data,
    }), 400);
  }
  const newId = await db.insertRecruit(c.env.DB, data);
  await audit(c, '新增', `编号 ${newId} ${data.company_name} - ${data.position}`);
  await flash(c, 'success', `新增成功（编号 ${newId}），已生成招聘信息记录`);
  if (String(form.get('then') || '') === 'docx') return redirect(c, `/docx/${newId}`);
  return redirect(c, '/');
}

async function handleEditGet(c: Ctx, id: number): Promise<Response> {
  const rec = await db.getRecruit(c.env.DB, id);
  if (!rec) return notFound(c);
  return htmlRes(c, pages.formPage({
    ...layoutOpts(c, '编辑招聘信息', 'add'), mode: 'edit', rec, rid: id,
  }));
}

async function handleEditPost(c: Ctx, form: FormData, id: number): Promise<Response> {
  const rec = await db.getRecruit(c.env.DB, id);
  if (!rec) return notFound(c);
  const data = formDataToRecord(form);
  const dateErr = fixPublishDate(data);
  if (dateErr) {
    await flash(c, 'error', dateErr);
    return htmlRes(c, pages.formPage({
      ...layoutOpts(c, '编辑招聘信息', 'add'), mode: 'edit', rec: data, rid: id,
    }), 400);
  }
  if (!data.company_name || !data.position) {
    await flash(c, 'error', '用人单位名称、招聘岗位为必填项');
    return htmlRes(c, pages.formPage({
      ...layoutOpts(c, '编辑招聘信息', 'add'), mode: 'edit', rec: data, rid: id,
    }), 400);
  }
  await db.updateRecruit(c.env.DB, id, data);
  await audit(c, '修改', `编号 ${id} ${data.company_name} - ${data.position}`);
  await flash(c, 'success', '修改已保存');
  return redirect(c, '/');
}

async function handleDelete(c: Ctx, form: FormData, id: number): Promise<Response> {
  const rec = await db.getRecruit(c.env.DB, id);
  if (!rec) return notFound(c);
  await db.deleteRecruit(c.env.DB, id);
  await audit(c, '删除', `编号 ${id} ${rec.company_name} - ${rec.position}`);
  await flash(c, 'success', `已删除编号 ${id} 的招聘信息`);
  return redirect(c, auth.safeNext(String(form.get('back') || '/'), '/'));
}

// --------------------------------------------------------------------------- //
// 预览 / Word / 二维码
// --------------------------------------------------------------------------- //
async function handlePreview(c: Ctx, id: number): Promise<Response> {
  const rec = await db.getRecruit(c.env.DB, id);
  if (!rec) return notFound(c);
  return htmlRes(c, pages.previewPage(prepare(rec, true), c.user));
}

async function handleDocx(c: Ctx, id: number): Promise<Response> {
  const rec = await db.getRecruit(c.env.DB, id);
  if (!rec) return notFound(c);
  const info = prepare(rec, true);
  const bytes = buildDocx(info);
  return fileRes(c, bytes, docFilename(info), DOCX_MIME);
}

/**
 * 勾选多条 → 导出到同一个 Word，每条一页（需登录）。
 * 表单字段 ids 可重复出现，顺序即页面顺序。
 */
/** 取表单里勾选的编号：去重、保持勾选顺序、丢弃非法值 */
function collectIds(form: FormData): number[] {
  const ids: number[] = [];
  for (const raw of form.getAll('ids')) {
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  return ids;
}

async function handleDocxSelected(c: Ctx, form: FormData): Promise<Response> {
  const ids = collectIds(form);

  if (!ids.length) {
    await flash(c, 'error', '请先勾选要导出的招聘信息');
    return redirect(c, '/');
  }
  if (ids.length > MAX_SELECTED) {
    await flash(c, 'error', `一次最多导出 ${MAX_SELECTED} 条，请分批勾选`);
    return redirect(c, '/');
  }

  const rows = await db.getRecruitsByIds(c.env.DB, ids);
  if (!rows.length) {
    await flash(c, 'error', '勾选的招聘信息已不存在，请刷新页面后重试');
    return redirect(c, '/');
  }

  const infos = rows.map((r: any) => prepare(r, true));
  const bytes = buildDocxMulti(infos);
  await audit(c, '导出选定 Word',
    `共 ${rows.length} 份（编号 ${rows.map((r: any) => r.id).join(',')}）`);
  return fileRes(c, bytes, multiDocFilename(rows.length), DOCX_MIME);
}

/**
 * 勾选多条 → 生成公众号可粘贴的 HTML（需登录）。
 * 返回一个预览页，带「复制到公众号 / 复制源码 / 下载 .html」三个动作。
 */
async function handleWechatSelected(c: Ctx, form: FormData): Promise<Response> {
  const ids = collectIds(form);
  if (!ids.length) {
    await flash(c, 'error', '请先勾选要发布到公众号的招聘信息');
    return redirect(c, '/');
  }
  if (ids.length > MAX_WECHAT) {
    await flash(c, 'error', `一篇推文最多放 ${MAX_WECHAT} 条，请分批勾选（当前 ${ids.length} 条）`);
    return redirect(c, '/');
  }

  const rows = await db.getRecruitsByIds(c.env.DB, ids);
  if (!rows.length) {
    await flash(c, 'error', '勾选的招聘信息已不存在，请刷新页面后重试');
    return redirect(c, '/');
  }

  const variants = buildWechatVariants(rows.map((r: any) => prepare(r, true)));
  await audit(c, '复制微信发布', `共 ${rows.length} 条（编号 ${rows.map((r: any) => r.id).join(',')}）`);
  const stamp = nowLocal().replace(/[-:]/g, '').replace(' ', '_').slice(0, 13);
  return htmlRes(c, pages.wechatPage({
    ...layoutOpts(c, '微信发布 · 招聘信息管理系统'),
    variants, themes: WECHAT_THEMES, count: rows.length,
    downloadName: `招聘微信发布_${stamp}_${rows.length}条.html`,
  }));
}

/**
 * 从查询串里取编号：支持 ?ids=1&ids=2 与 ?ids=1,2,3 两种写法（去重、保序、丢弃非法值）。
 */
function queryIds(u: URL): number[] {
  const ids: number[] = [];
  for (const raw of u.searchParams.getAll('ids')) {
    for (const part of String(raw).replace(/，/g, ',').split(',')) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}

/** 切换间隔：只接受预设值，认不出就退回默认 8 秒 */
function pickInterval(raw: unknown): number {
  const n = Number(String(raw ?? '').trim());
  return LIVE_INTERVALS.includes(n) ? n : LIVE_DEFAULT_INTERVAL;
}

/** 直播页用的精简数据：状态算成实际值，岗位要求按行拆开 */
function liveItems(rows: any[]): pages.LiveItem[] {
  const today = todayIso();
  return rows.map((r: any) => {
    const g = (k: string) => (r?.[k] === null || r?.[k] === undefined ? '' : String(r[k])).trim();
    const st = String(r.eff_status || effStatus(r, today));
    const lines = g('requirements').split(/\r?\n/)
      .map((s) => s.trim().replace(/^[·•\-—　\s]+/, ''))
      .filter(Boolean);
    return {
      id: Number(r.id) || 0,
      company: g('company_name'),
      position: g('position'),
      headcount: g('headcount'),
      salary: g('salary') || '面议',
      address: g('address'),
      phone: g('phone'),
      reqLines: lines,
      statusKey: st,
      statusLabel: STATUS_LABELS[st] || '招聘中',
    };
  });
}

/**
 * 直播轮播页（需登录）：勾选的招聘信息在手机上按设定间隔循环播放。
 * 入口是列表页的「📺 直播轮播」按钮（POST），拿到 ids 后 302 到 GET 版本，
 * 这样地址栏里的 ?ids=1,2,3&interval=8 可以直接收藏 / 换手机打开。
 */
async function handleLive(c: Ctx, form: FormData | null): Promise<Response> {
  if (c.req.method === 'POST') {
    const ids = collectIds(form!);
    if (!ids.length) {
      await flash(c, 'error', '请先勾选要直播轮播的招聘信息');
      return redirect(c, '/');
    }
    if (ids.length > MAX_LIVE) {
      await flash(c, 'error', `一次最多轮播 ${MAX_LIVE} 条，请分批勾选（当前 ${ids.length} 条）`);
      return redirect(c, '/');
    }
    const iv = pickInterval(form!.get('interval'));
    return redirect(c, `/live?ids=${ids.join(',')}&interval=${iv}`);
  }

  const ids = queryIds(c.url);
  if (!ids.length) {
    await flash(c, 'error', '请先在列表里勾选招聘信息，再点「直播轮播」');
    return redirect(c, '/');
  }
  if (ids.length > MAX_LIVE) {
    await flash(c, 'error', `一次最多轮播 ${MAX_LIVE} 条，请分批勾选（当前 ${ids.length} 条）`);
    return redirect(c, '/');
  }

  const rows = await db.getRecruitsByIds(c.env.DB, ids);
  if (!rows.length) {
    await flash(c, 'error', '勾选的招聘信息已不存在，请刷新页面后重试');
    return redirect(c, '/');
  }

  const interval = pickInterval(c.url.searchParams.get('interval'));
  await audit(c, '直播轮播',
    `共 ${rows.length} 条，间隔 ${interval} 秒（编号 ${rows.map((r: any) => r.id).join(',')}）`);
  return htmlRes(c, pages.livePage({
    items: liveItems(rows), interval, choices: LIVE_INTERVALS, backUrl: '/',
  }));
}

/**
 * 整库导出为 SQL（仅管理员）：表结构 + 索引 + 全部数据，可直接重放恢复。
 */
async function handleBackup(c: Ctx): Promise<Response> {
  if (!c.isAdmin) {
    await flash(c, 'error', '只有管理员才能备份数据库');
    return redirect(c, '/');
  }
  const { sql, bytes, truncated } = await db.dumpSql(c.env.DB);
  await audit(c, '备份数据库',
    `下载 SQL 备份（${(bytes / 1024).toFixed(1)} KB${
      truncated.length ? `，已截断：${truncated.join('、')}` : ''}）`);
  const stamp = nowLocal().replace(/[-:]/g, '').replace(' ', '_').slice(0, 15);
  return fileRes(c, new TextEncoder().encode(sql), `招聘信息备份_${stamp}.sql`, 'application/sql');
}

/**
 * 按起止日期导出 → 同一个 Word，每条一页（需登录）。
 * start / end 都可省略：只填一头表示「某天起」或「截至某天」，都不填等于全部。
 */
async function handleDocxRange(c: Ctx): Promise<Response> {
  const q = (c.url.searchParams.get('q') || '').trim();
  const { start, end } = dateRange(c.url.searchParams.get('start'), c.url.searchParams.get('end'));
  const showFull = c.url.searchParams.get('show_full') === '1';
  const showExpired = c.url.searchParams.get('show_expired') === '1';

  const rows = await db.listAllRecruit(c.env.DB, q, start, end, showFull, showExpired);
  if (!rows.length) {
    await flash(c, 'error', `所选日期范围内没有招聘信息（${rangeLabel(start, end)}）`);
    return redirect(c, '/');
  }
  if (rows.length > MAX_RANGE) {
    await flash(c, 'error', `该日期范围共 ${rows.length} 条，一次最多导出 ${MAX_RANGE} 条，请缩小范围后重试`);
    return redirect(c, '/');
  }

  const infos = rows.map((r: any) => prepare(r, true));
  const bytes = buildDocxMulti(infos);
  await audit(c, '按日期导出 Word', `共 ${rows.length} 份（${rangeLabel(start, end)}）`);
  return fileRes(c, bytes, rangeDocFilename(rows.length, start, end), DOCX_MIME);
}

async function handleZip(c: Ctx): Promise<Response> {  const q = (c.url.searchParams.get('q') || '').trim();
  const rows = await db.listAllRecruit(c.env.DB, q);
  if (!rows.length) {
    await flash(c, 'error', '没有可生成 Word 的招聘信息');
    return redirect(c, '/');
  }
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const rec of rows) {
    const info = prepare(rec, true);
    let name = `${String(rec.id).padStart(3, '0')}_${docFilename(info)}`;
    if (used.has(name)) {
      let n = 2;
      while (used.has(name.replace(/\.docx$/, `(${n}).docx`))) n++;
      name = name.replace(/\.docx$/, `(${n}).docx`);
    }
    used.add(name);
    files[name] = buildDocx(info);
  }
  const zip = zipSync(files, { level: 6 });
  await audit(c, '批量生成 Word', `共 ${rows.length} 份${q ? `，关键词：${q}` : ''}`);
  const today = nowLocal().slice(0, 10).replace(/-/g, '');
  return fileRes(c, zip, `招聘简章_${rows.length}份_${today}.zip`, 'application/zip');
}

// --------------------------------------------------------------------------- //
// Excel 导入 / 导出 / 模板
// --------------------------------------------------------------------------- //
function handleImportGet(c: Ctx): Response {
  return htmlRes(c, pages.importPage({ ...layoutOpts(c, '导入 Excel · 招聘信息管理系统', 'import') }));
}

async function handleImportPost(c: Ctx, form: FormData): Promise<Response> {
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.name) {
    await flash(c, 'error', '请选择要导入的 Excel / CSV 文件');
    return redirect(c, '/import');
  }
  const buf = new Uint8Array(await (file as File).arrayBuffer());
  if (buf.byteLength > 32 * 1024 * 1024) {
    await flash(c, 'error', '文件过大（上限 32MB），请拆分后再导入');
    return redirect(c, '/import');
  }

  let result;
  try {
    result = parseImport((file as File).name, buf);
  } catch (err: any) {
    await flash(c, 'error', `导入失败：${err?.message || err}`);
    return redirect(c, '/import');
  }

  if (!result.valid.length) {
    await flash(c, 'error', '文件中没有可导入的有效数据，请检查表头与内容');
    return htmlRes(c, pages.importPage({
      ...layoutOpts(c, '导入 Excel · 招聘信息管理系统', 'import'),
      result: { inserted: 0, errors: result.errors, skipped: result.skipped, filename: (file as File).name },
    }));
  }

  const inserted = await db.insertManyRecruit(c.env.DB, result.valid);
  await audit(c, '导入 Excel', `${(file as File).name}：成功 ${inserted} 条`);
  await flash(c, 'success',
    `导入完成：成功 ${inserted} 条，跳过 ${result.skipped + result.errors.length} 行`);
  return htmlRes(c, pages.importPage({
    ...layoutOpts(c, '导入 Excel · 招聘信息管理系统', 'import'),
    result: { inserted, errors: result.errors, skipped: result.skipped, filename: (file as File).name },
  }));
}

async function handleExport(c: Ctx): Promise<Response> {
  const q = (c.url.searchParams.get('q') || '').trim();
  // 日期留空 = 导出全部；只填一头也可以（起始 / 截至）
  const { start, end } = dateRange(c.url.searchParams.get('start'), c.url.searchParams.get('end'));
  const showFull = c.url.searchParams.get('show_full') === '1';
  const showExpired = c.url.searchParams.get('show_expired') === '1';
  const rows = await db.listAllRecruit(c.env.DB, q, start, end, showFull, showExpired);
  const bytes = exportXlsx(rows);
  await audit(c, '导出 Excel',
    `共 ${rows.length} 条（${rangeLabel(start, end)}${q ? `，关键词：${q}` : ''}）`);
  const today = nowLocal().slice(0, 10).replace(/-/g, '');
  return fileRes(c, bytes, rangeXlsxFilename(start, end, today), XLSX_MIME);
}

function handleTemplate(c: Ctx): Response {
  return fileRes(c, buildTemplate(), '招聘信息导入模板.xlsx', XLSX_MIME);
}

// --------------------------------------------------------------------------- //
// 修改密码
// --------------------------------------------------------------------------- //
function handlePasswordGet(c: Ctx): Response {
  const first = !!c.user?.must_change;
  return htmlRes(c, pages.passwordPage({ ...layoutOpts(c, '修改密码 · 招聘信息管理系统'), first }));
}

async function handlePasswordPost(c: Ctx, form: FormData): Promise<Response> {
  const user = c.user!;
  const oldPwd = String(form.get('old_password') || '');
  const newPwd = String(form.get('new_password') || '');
  const again = String(form.get('confirm_password') || '');
  const first = !!user.must_change;
  const render = (status: number) => htmlRes(c, pages.passwordPage({
    ...layoutOpts(c, '修改密码 · 招聘信息管理系统'), first,
  }), status);

  if (!(await auth.verifyPassword(oldPwd, user))) {
    await flash(c, 'error', '当前密码不正确');
    return render(400);
  }
  if (newPwd.length < 6) { await flash(c, 'error', '新密码至少 6 位'); return render(400); }
  if (newPwd !== again) { await flash(c, 'error', '两次输入的新密码不一致'); return render(400); }
  if (newPwd === oldPwd) { await flash(c, 'error', '新密码不能与当前密码相同'); return render(400); }

  const iterations = Number(c.env.PBKDF2_ITERATIONS || 100000);
  const { hash, salt } = await auth.hashPassword(newPwd, iterations);
  await db.updatePassword(c.env.DB, user.id, hash, salt, iterations, 0);
  await audit(c, '修改密码', '密码已更新');
  await flash(c, 'success', '密码修改成功，请牢记新密码');
  return redirect(c, '/');
}

// --------------------------------------------------------------------------- //
// 用户管理
// --------------------------------------------------------------------------- //
async function handleUsers(c: Ctx): Promise<Response> {
  const rows = await db.listUsers(c.env.DB);
  return htmlRes(c, pages.usersPage({
    ...layoutOpts(c, '用户管理 · 招聘信息管理系统', 'users'), rows,
  }));
}

async function handleUserAction(c: Ctx, form: FormData, uid: number): Promise<Response> {
  const action = String(form.get('action') || '');
  const target = await db.getUserById(c.env.DB, uid);
  if (!target) return notFound(c);
  const me = c.user!;
  const name = target.username;

  const done = async (msg: string, cat = 'success') => {
    await flash(c, cat, msg);
    return redirect(c, '/users');
  };

  if (uid === me.id && ['disable', 'reject', 'delete', 'demote'].includes(action)) {
    return done('不能对自己的账号执行该操作', 'error');
  }
  if (['disable', 'delete', 'demote'].includes(action)
      && target.role === 'admin' && target.status === 'active'
      && (await db.activeAdminCount(c.env.DB)) <= 1) {
    return done('至少要保留一个正常状态的管理员账号', 'error');
  }

  switch (action) {
    case 'approve': {
      if (target.status !== 'pending') return done(`账号 ${name} 不是待审批状态`, 'error');
      await db.approveUser(c.env.DB, uid, me.username);
      await audit(c, '审批通过', `${name}（${target.real_name || '未填姓名'}）`);
      return done(`已通过 ${name} 的注册申请，该账号现在可以登录使用`);
    }
    case 'reject': {
      if (target.status !== 'pending') return done(`账号 ${name} 不是待审批状态`, 'error');
      await db.deleteUser(c.env.DB, uid);
      await audit(c, '审批拒绝', `${name}（${target.real_name || '未填姓名'}）`);
      return done(`已拒绝 ${name} 的注册申请，账号记录已删除`);
    }
    case 'disable':
      await db.setUserStatus(c.env.DB, uid, 'disabled');
      await audit(c, '停用账号', name);
      return done(`已停用 ${name}，该账号将无法登录`);
    case 'enable':
      await db.setUserStatus(c.env.DB, uid, 'active');
      await audit(c, '启用账号', name);
      return done(`已启用 ${name}`);
    case 'promote':
      await db.setUserRole(c.env.DB, uid, 'admin');
      await audit(c, '设为管理员', name);
      return done(`已将 ${name} 设为管理员`);
    case 'demote':
      await db.setUserRole(c.env.DB, uid, 'user');
      await audit(c, '取消管理员', name);
      return done(`已取消 ${name} 的管理员权限`);
    case 'resetpwd': {
      const temp = auth.randomPassword();
      const iterations = Number(c.env.PBKDF2_ITERATIONS || 100000);
      const { hash, salt } = await auth.hashPassword(temp, iterations);
      await db.updatePassword(c.env.DB, uid, hash, salt, iterations, 1);
      await audit(c, '重置密码', `${name} 的密码已被管理员重置`);
      return done(`已重置 ${name} 的密码，临时密码：${temp}（登录后需立即修改）`);
    }
    case 'delete':
      await db.deleteUser(c.env.DB, uid);
      await audit(c, '删除账号', `${name}（${target.role}）`);
      return done(`已删除账号 ${name}`);
    default:
      return done('未知操作', 'error');
  }
}

function notFound(c: Ctx): Response {
  return htmlRes(c, pages.errorPage(layoutOpts(c, '页面不存在'), 404,
    '页面或记录不存在', '该招聘信息可能已被删除，请返回列表查看。', '🔍'), 404);
}
