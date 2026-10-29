/**
 * 服务端渲染的 HTML 页面（模板字符串，无模板引擎依赖）
 */
import { CSS } from './css';
import {
  DocInfo, FIELD_LABELS, FIELDS, QR_CAPTION, STATUS_LABELS, STATUS_OPTIONS, effStatus, normStatus,
  todayIso,
} from './format';

export function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 安全地把 JSON 塞进 <script>：转义 <、>、&，避免提前闭合脚本 */
function jsJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface UserLike {
  id: number;
  username: string;
  role: string;
  status: string;
  must_change: number;
}

export interface LayoutOpts {
  title: string;
  /** 站点名称，来自环境变量 SITE_NAME，缺省「招聘信息管理系统」 */
  siteName?: string;
  csrf: string;
  user?: UserLike | null;
  isAdmin?: boolean;
  pendingCount?: number;
  allowRegister?: boolean;
  flashes?: [string, string][];
  active?: string;
  /** 单篇微信发布最多条数（选择条上的提示用） */
  maxWechat?: number;
  /** 单次直播轮播最多条数（选择条上的提示用） */
  maxLive?: number;
}

export function layout(o: LayoutOpts, body: string): string {
  const u = o.user;
  const site = o.siteName || '招聘信息管理系统';
  const lock = (cond: boolean) => (cond ? '<span class="lock" title="需登录">🔒</span>' : '');
  const flashes = (o.flashes || []).map(([cat, msg]) =>
    `<div class="flash ${h(cat)}">${h(msg)}</div>`).join('');

  const nav = `
    <a href="/" class="${o.active === 'index' ? 'on' : ''}">招聘列表</a>
    <a href="/add" class="${o.active === 'add' ? 'on' : ''}">新增招聘${lock(!u)}</a>
    <a href="/import" class="${o.active === 'import' ? 'on' : ''}">导入 Excel${lock(!u)}</a>
    <a href="/export/excel">导出 Excel${lock(!u)}</a>
    <a href="/docx/zip">批量生成 Word${lock(!u)}</a>
    ${o.isAdmin ? `<a href="/users" class="${o.active === 'users' ? 'on' : ''}">用户管理${
      o.pendingCount ? `<span class="badge">${o.pendingCount}</span>` : ''}</a>
    <a href="/audit" class="${o.active === 'audit' ? 'on' : ''}">操作日志</a>` : ''}`;

  const userbox = u
    ? `<span class="who"><i class="dot"></i>${h(u.username)}${o.isAdmin ? '<span class="mini-role">管理员</span>' : ''}</span>
       <a class="link-mini" href="/password">修改密码</a>
       <form method="post" action="/logout" class="inline">
         <input type="hidden" name="_csrf" value="${h(o.csrf)}">
         <button type="submit" class="link-mini as-btn">退出</button>
       </form>`
    : `${o.allowRegister ? '<a class="link-mini" href="/register">注册账号</a>' : ''}
       <a class="btn btn-xs btn-primary" href="/login">登录</a>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(o.title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<header class="topbar"><div class="wrap bar-inner">
  <a class="brand" href="/"><span class="logo">招</span><span>${h(site)}</span></a>
  <nav class="nav">${nav}</nav>
  <div class="userbox">${userbox}</div>
</div></header>
<main class="wrap main">
  ${u && u.must_change ? '<div class="flash error">当前仍在使用初始密码，存在数据泄露风险，请<a href="/password"><b>立即修改密码</b></a>。</div>' : ''}
  ${flashes}
  ${body}
</main>
<footer class="foot">${h(site)} · 每条招聘信息一键生成单页 A4 Word 简章</footer>
</body>
</html>`;
}

// --------------------------------------------------------------------------- //
// 列表
// --------------------------------------------------------------------------- //
export function indexPage(o: LayoutOpts & {
  rows: any[]; q: string; page: number; pages: number; total: number;
  per: number; perChoices: number[]; pageNums: number[];
  start: string; end: string; filtered: boolean;
  showFull: boolean; showExpired: boolean;
  hiddenFull: number; hiddenExpired: number;
}): string {
  const { rows, q, page, pages, total, user, per, start, end, filtered } = o;
  const { showFull, showExpired, hiddenFull, hiddenExpired } = o;
  const defaultPer = o.perChoices[0] || 15;
  const today = todayIso();

  // 列表页链接：带上关键词、日期区间、状态开关与每页条数（page=1、per=默认值时省略）
  const listUrl = (p: number) => `/${qs({
    q: q || undefined,
    start: start || undefined,
    end: end || undefined,
    show_full: showFull ? '1' : undefined,
    show_expired: showExpired ? '1' : undefined,
    per: per === defaultPer ? undefined : per,
    page: p > 1 ? p : undefined,
  })}`;

  // 状态开关的隐藏域（放进搜索框 / 导出表单里，避免一提交就把状态重置回默认）
  const statusHidden = `${showFull ? '<input type="hidden" name="show_full" value="1">' : ''}`
    + `${showExpired ? '<input type="hidden" name="show_expired" value="1">' : ''}`;

  // 序号按当前页自然顺序生成（1、2、3…），与数据库 id 无关；勾选框仍用真实 id
  const tableRows = rows.map((r, i) => {
    const st = String(r.eff_status || effStatus(r, today));
    const seq = (page - 1) * per + i + 1;
    return `
    <tr class="${st === 'expired' ? 'row-expired' : st === 'full' ? 'row-full' : ''}">
      <td class="mono">${user ? `<input type="checkbox" class="pick-box" name="ids" value="${r.id}"
        data-id="${r.id}" form="selForm" aria-label="选择序号 ${seq}"> ` : ''}${seq}</td>
      <td class="strong">${h(r.company_name)}</td>
      <td>${h(r.position)}</td>
      <td class="center">${h(r.headcount || '—')}</td>
      <td class="center salary">${h(r.salary || '面议')}</td>
      <td class="req">${r.requirements
        ? `<div class="req-text" title="${h(r.requirements)}">${h(r.requirements)}</div>` : '—'}</td>
      <td class="small">${h(r.address || '—')}</td>
      <td class="mono">${h(r.phone || '—')}</td>
      <td class="mono center">${h(r.publish_date || '—')}</td>
      <td class="center"><span class="st st-${st}">${h(STATUS_LABELS[st] || '招聘中')}</span></td>
      <td class="ops">
        <a class="btn btn-xs" href="/preview/${r.id}">预览</a>
        <a class="btn btn-xs btn-primary" href="/docx/${r.id}">Word</a>
        ${user ? `<a class="btn btn-xs" href="/edit/${r.id}">编辑</a>
        <form method="post" action="/delete/${r.id}" class="inline"
              onsubmit="return confirm('确定删除第 ${seq} 条「${h(r.company_name)} - ${h(r.position)}」吗？此操作不可恢复。');">
          <input type="hidden" name="_csrf" value="${h(o.csrf)}">
          <input type="hidden" name="back" value="${h(listUrl(page))}">
          <button class="btn btn-xs btn-danger" type="submit">删除</button>
        </form>`
        : `<a class="btn btn-xs btn-ghost" href="/login?next=${encodeURIComponent(`/edit/${r.id}`)}" title="编辑与删除需登录">🔒 编辑</a>`}
      </td>
    </tr>`;
  }).join('');

  const pager = `
    <div class="pager">
      ${page > 1 ? `<a class="btn btn-xs" href="${listUrl(1)}">首页</a>
      <a class="btn btn-xs" href="${listUrl(page - 1)}">上一页</a>` : ''}
      ${o.pageNums.map((n) => (n === page
        ? `<span class="pager-num on" aria-current="page">${n}</span>`
        : `<a class="pager-num" href="${listUrl(n)}">${n}</a>`)).join('')}
      ${page < pages ? `<a class="btn btn-xs" href="${listUrl(page + 1)}">下一页</a>
      <a class="btn btn-xs" href="${listUrl(pages)}">末页</a>` : ''}
      <span class="pager-info">第 ${page} / ${pages} 页 · 每页 ${per} 条 · 共 ${total} 条</span>
    </div>`;

  const empty = `
    <div class="empty">
      <div class="empty-icon">📄</div>
      <h3>${filtered ? '没有符合条件的招聘信息' : '还没有招聘信息'}</h3>
      <p>${filtered
        ? '换个关键词或调整日期区间试试，也可以<a href="/">清除筛选</a>查看全部。'
        : '可以手动新增一条，或从 Excel 批量导入已有招聘数据。'}</p>
      <div class="empty-actions">
        <a class="btn btn-primary" href="/add">新增招聘信息</a>
        <a class="btn" href="/import">从 Excel 导入</a>
      </div>
    </div>`;

  const notice = !user ? `
    <div class="notice">
      <span class="notice-ic">🔒</span>
      <div><b>当前为访客浏览模式。</b>招聘列表、打印预览与单条 Word 简章可自由使用；
      新增 / 编辑 / 删除、导入 Excel、导出 Excel、批量生成 Word、按日期导出、微信发布需登录后操作。</div>
      <a class="btn btn-xs btn-primary" href="/login">登录</a>
    </div>` : '';

  const selbar = user ? `
  <form id="selForm" method="post" action="/docx/selected" class="selbar">
    <input type="hidden" name="_csrf" value="${h(o.csrf)}">
    <span class="selbar-count">已选 <b id="selCount">0</b> 条</span>
    <button class="btn btn-primary btn-xs sel-act" type="submit" disabled>📄 导出选定为 Word（单文件）</button>
    <button class="btn btn-soft btn-xs sel-act" type="submit" disabled
            formaction="/wechat/selected">📋 复制微信发布</button>
    <button class="btn btn-soft btn-xs sel-act" type="submit" disabled
            formaction="/live">📺 直播轮播</button>
    <span class="selbar-hint">Word：每条一页合并成一个文件；微信：生成公众号排版，一键复制到剪贴板（每篇最多 ${o.maxWechat || 30} 条）；直播：手机全屏循环播放，可设切换间隔（最多 ${o.maxLive || 30} 条）</span>
  </form>` : '';

  const pickScript = user ? `
<script>
(function () {
  var perSel = document.getElementById('perSel');
  if (perSel) perSel.addEventListener('change', function () { perSel.form.submit(); });

  var form = document.getElementById('selForm');
  if (!form) return;
  // 只取行内的复选框：表头的「全选」也带 .pick-box（为了 th .pick-box 的间距样式），
  // 但它不是数据项，混进来会导致「全选」把自己也算成一条、并且被 sync() 立刻取消勾选。
  var boxes = Array.prototype.slice.call(
    document.querySelectorAll('.pick-box[name="ids"]'));
  var all = document.getElementById('pickAll');
  var counter = document.getElementById('selCount');
  var btns = Array.prototype.slice.call(document.querySelectorAll('.sel-act'));
  function picked() { return boxes.filter(function (b) { return b.checked; }); }
  function sync() {
    var n = picked().length;
    counter.textContent = n;
    btns.forEach(function (b) { b.disabled = n === 0; });
    if (all) {
      all.checked = n > 0 && n === boxes.length;
      all.indeterminate = n > 0 && n < boxes.length;
    }
  }
  boxes.forEach(function (b) { b.addEventListener('change', sync); });
  // 目标状态从事件里取：sync() 会按行状态重写 all.checked，直接读 all.checked 会拿到被改写后的值
  if (all) all.addEventListener('change', function (e) {
    var on = e.target.checked;
    boxes.forEach(function (b) { b.checked = on; });
    sync();
  });
  form.addEventListener('submit', function (e) { if (!picked().length) e.preventDefault(); });
  sync();
})();
</script>` : '';

  const hiddenParts: string[] = [];
  if (!showFull && hiddenFull) hiddenParts.push(`<b>${hiddenFull}</b> 条「已招满」`);
  if (!showExpired && hiddenExpired) hiddenParts.push(`<b>${hiddenExpired}</b> 条「已失效」`);
  const allUrl = `/${qs({
    q: q || undefined,
    start: start || undefined,
    end: end || undefined,
    show_full: '1',
    show_expired: '1',
    per: per === defaultPer ? undefined : per,
  })}`;
  // 「发布满 1 个月自动失效」只在确实隐藏了失效记录时才提示
  const expHint = hiddenParts.some((p) => p.indexOf('已失效') >= 0)
    ? '（发布满 1 个月自动失效）' : '';
  const filterNote = hiddenParts.length
    ? `<div class="filter-note">已隐藏 ${hiddenParts.join('、')}记录${expHint}，<a href="${allUrl}">全部显示</a></div>`
    : '';

  const body = `
  <div class="page-head">
    <div>
      <h1>招聘信息列表</h1>
      <p class="sub">共 <b>${total}</b> 条招聘信息${
  q ? `（关键词：${h(q)}）` : ''}${
  start || end ? `（日期：${start || '不限'} ~ ${end || '不限'}）` : ''}${
  showFull || showExpired ? `（含${showFull ? '已招满' : ''}${showFull && showExpired ? '、' : ''}${showExpired ? '已失效' : ''}）` : ''}，每条可直接生成单页 Word 简章打印</p>
    </div>
    <div class="head-actions"><a class="btn btn-primary" href="/add">+ 新增招聘信息</a></div>
  </div>

  <div class="toolbar">
    <form class="search" method="get" action="/">
      <input type="text" name="q" value="${h(q)}" placeholder="搜索单位名称 / 岗位 / 地址 / 电话…">
      ${start ? `<input type="hidden" name="start" value="${h(start)}">` : ''}
      ${end ? `<input type="hidden" name="end" value="${h(end)}">` : ''}
      ${statusHidden}
      <input type="hidden" name="per" value="${per}">
      <button class="btn" type="submit">搜索</button>
      ${filtered ? '<a class="btn btn-ghost" href="/">清除筛选</a>' : ''}
    </form>
    <div class="tool-actions">
      <a class="btn btn-soft" href="/docx/zip${qs({ q: q || undefined })}">📦 批量生成 Word（ZIP）</a>
      <a class="btn btn-soft" href="/import">⬆ 导入 Excel</a>
    </div>
  </div>

  <form class="datebar" method="get" action="/">
    ${q ? `<input type="hidden" name="q" value="${h(q)}">` : ''}
    <span class="datebar-title">按发布日期筛选 / 导出</span>
    <label class="datebar-f">起始 <input type="date" name="start" value="${h(start)}" aria-label="发布日期起"></label>
    <label class="datebar-f">结束 <input type="date" name="end" value="${h(end)}" aria-label="发布日期止"></label>
    <label class="datebar-f">每页
      <select name="per" id="perSel" aria-label="每页条数">
        ${o.perChoices.map((n) => `<option value="${n}"${n === per ? ' selected' : ''}>${n} 条</option>`).join('')}
      </select>
    </label>
    <span class="datebar-title">招聘状态</span>
    <label class="datebar-c"><input type="checkbox" name="show_full" value="1"${showFull ? ' checked' : ''}> 显示已招满</label>
    <label class="datebar-c"><input type="checkbox" name="show_expired" value="1"${showExpired ? ' checked' : ''}> 显示已失效</label>
    <button class="btn btn-soft" type="submit">🔍 筛选</button>
    <button class="btn btn-soft" type="submit" formaction="/export/excel">⬇ 导出 Excel</button>
    <button class="btn btn-soft" type="submit" formaction="/docx/range">📄 导出 Word（每条一页）</button>
    <span class="datebar-hint">日期按「发布日期」比较，留空 = 全部；发布满 1 个月自动失效；筛选同时作用于列表与导出</span>
  </form>
  ${filterNote}
  ${selbar}
  ${notice}
  ${rows.length ? `<div class="table-card"><table class="data-table">
    <thead><tr>
      <th style="width:72px">${user ? '<input type="checkbox" id="pickAll" class="pick-box" title="全选本页" aria-label="全选本页"> ' : ''}序号</th><th style="width:140px">用人单位名称</th>
      <th style="width:100px">招聘岗位</th><th style="width:52px">招聘数</th>
      <th style="width:110px">工资待遇（元）</th><th style="width:150px">岗位要求</th>
      <th style="width:94px">地址</th><th style="width:128px">联系电话</th>
      <th style="width:96px">发布日期</th><th style="width:86px">招聘状态</th><th style="width:242px">操作</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div>${pager}` : empty}${pickScript}`;

  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 直播轮播（手机全屏，按设定间隔循环播放勾选的招聘信息）
// --------------------------------------------------------------------------- //
export interface LiveItem {
  id: number;
  company: string;
  position: string;
  headcount: string;
  salary: string;
  address: string;
  phone: string;
  reqLines: string[];
  statusKey: string;
  statusLabel: string;
}

/** 岗位要求里本来就带序号的行（1. / 一、 / （1））不再额外画圆点 */
function hasOwnNumber(line: string): boolean {
  const c = line.slice(0, 1);
  return /\d/.test(c) || '一二三四五六七八九十（('.includes(c);
}

/**
 * 直播轮播页：整页自包含（不引用站内 CSS / 导航），
 * 手机上就是一块 100dvh 的暗色舞台，桌面上居中显示 9:16 手机画面。
 */
export function livePage(o: {
  items: LiveItem[]; interval: number; choices: number[]; backUrl?: string;
}): string {
  const back = o.backUrl || '/';
  const slides = o.items.map((it, i) => `
      <section class="slide" data-i="${i}">
        <div class="company">${h(it.company)}</div>
        <h1 class="position">${h(it.position)}</h1>
        <div class="meta">${
  it.salary ? `<span class="salary">${h(it.salary)}</span>` : ''}${
  it.headcount ? `<span class="chip">招 ${h(it.headcount)} 人</span>` : ''}<span class="badge s-${
  h(it.statusKey)}">${h(it.statusLabel)}</span></div>${
  it.reqLines.length ? `
        <div class="req-block">
          <div class="req-title">岗位要求</div>
          <ul class="req" data-fit>${it.reqLines.map((ln) =>
    `<li${hasOwnNumber(ln) ? ' class="no-dot"' : ''}>${h(ln)}</li>`).join('')}</ul>
        </div>` : ''}${
  it.address || it.phone ? `
        <div class="contact">${
    it.address ? `<div class="row"><span class="ic">📍</span><span>${h(it.address)}</span></div>` : ''}${
    it.phone ? `<div class="row"><span class="ic">📞</span><span class="phone">${h(it.phone)}</span></div>` : ''}
        </div>` : ''}
      </section>`).join('');

  const options = o.choices.map((s) =>
    `<option value="${s}"${s === o.interval ? ' selected' : ''}>${s} 秒</option>`).join('');

  const body = o.items.length ? `
    <div class="track" id="track">${slides}
    </div>` : `
    <div class="empty">没有可轮播的招聘信息，<a href="${h(back)}">返回列表</a></div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1020">
<meta name="robots" content="noindex">
<title>直播招聘轮播 · 招聘信息管理系统</title>
<style>
  :root {
    --bg: #0b1020;
    --bg2: #121a30;
    --fg: #f2f5fb;
    --dim: #9aa7c2;
    --line: rgba(255, 255, 255, .12);
    --brand: #3b82f6;
    --gold: #ffc247;
    --ok: #34d399;
    --warn: #fbbf24;
    --off: #94a3b8;
    --safe-b: env(safe-area-inset-bottom, 0px);
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0; height: 100%; overflow: hidden;
    background: var(--bg); color: var(--fg);
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    overscroll-behavior: none;
  }
  .stage {
    position: relative; height: 100dvh; width: 100%;
    display: flex; flex-direction: column;
    background:
      radial-gradient(120% 80% at 50% -10%, #1b2a4a 0%, transparent 60%),
      radial-gradient(100% 70% at 50% 110%, #16233d 0%, transparent 55%),
      var(--bg);
    overflow: hidden;
  }
  /* 桌面/横屏：居中一个 9:16 手机画面，方便预览与投屏 */
  @media (min-aspect-ratio: 3/4) {
    body { display: flex; align-items: center; justify-content: center; background: #05070d; }
    .stage {
      width: min(100vw, calc(100dvh * 9 / 16));
      height: 100dvh;
      border-left: 1px solid rgba(255, 255, 255, .07);
      border-right: 1px solid rgba(255, 255, 255, .07);
      box-shadow: 0 0 80px rgba(0, 0, 0, .8);
    }
    /* 桌面预览时 vw 取的是整个窗口宽，字号会偏小，改成按高度换算 */
    .company { font-size: min(20px, 2.3vh); }
    .position { font-size: min(50px, 5.6vh); }
    .salary { font-size: min(36px, 4vh); }
    .chip, .badge { font-size: min(15px, 1.7vh); }
    .req { font-size: min(19px, 2.2vh); max-height: 36vh; }
    .row { font-size: min(17px, 2vh); }
  }

  /* ---------- 顶部状态条 ---------- */
  .topbar {
    display: flex; align-items: center; gap: 8px;
    padding: max(14px, env(safe-area-inset-top, 0px)) 20px 10px;
    font-size: 13px; color: var(--dim); letter-spacing: .04em;
    transition: opacity .35s ease;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
    box-shadow: 0 0 0 0 rgba(239, 68, 68, .7);
    animation: pulse 1.8s infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, .55); }
    70% { box-shadow: 0 0 0 9px rgba(239, 68, 68, 0); }
    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }
  .counter { margin-left: auto; font-variant-numeric: tabular-nums; }
  .counter b { color: var(--fg); font-size: 15px; }

  /* ---------- 内容区 ---------- */
  .viewport { flex: 1; overflow: hidden; position: relative; }
  .track {
    display: flex; height: 100%;
    transition: transform .45s cubic-bezier(.22, .61, .36, 1);
    will-change: transform;
  }
  .slide {
    flex: 0 0 100%; height: 100%;
    padding: 4px 22px 0;
    display: flex; flex-direction: column;
    justify-content: center; gap: 14px;
    overflow: hidden;
  }
  .company {
    font-size: clamp(15px, 4.6vw, 20px); color: #a9c0e8;
    font-weight: 600; letter-spacing: .02em;
    display: flex; align-items: center; gap: 8px;
  }
  .company::before {
    content: ""; width: 4px; height: 1.05em; border-radius: 2px;
    background: linear-gradient(180deg, #60a5fa, #2563eb); flex: none;
  }
  .position {
    margin: 0; font-size: clamp(30px, 10.5vw, 46px); line-height: 1.12;
    font-weight: 800; letter-spacing: -.01em;
    background: linear-gradient(180deg, #ffffff 30%, #cfe0ff 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    word-break: break-word;
  }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .salary {
    font-size: clamp(24px, 7.4vw, 34px); font-weight: 800; color: var(--gold);
    font-variant-numeric: tabular-nums; letter-spacing: -.01em;
  }
  .chip {
    font-size: clamp(13px, 3.6vw, 15px); padding: 4px 12px; border-radius: 999px;
    background: rgba(59, 130, 246, .16); color: #bfd4ff;
    border: 1px solid rgba(96, 165, 250, .35); white-space: nowrap;
  }
  .badge {
    font-size: 12px; padding: 4px 10px; border-radius: 999px;
    border: 1px solid transparent; white-space: nowrap; font-weight: 600;
  }
  .badge.s-active { color: #6ee7b7; background: rgba(52, 211, 153, .12); border-color: rgba(52, 211, 153, .35); }
  .badge.s-full { color: #fcd34d; background: rgba(251, 191, 36, .12); border-color: rgba(251, 191, 36, .35); }
  .badge.s-expired { color: #cbd5e1; background: rgba(148, 163, 184, .12); border-color: rgba(148, 163, 184, .3); }

  .req-block { margin-top: 2px; min-height: 0; display: flex; flex-direction: column; }
  .req-title {
    font-size: 13px; color: var(--dim); letter-spacing: .18em;
    margin-bottom: 8px; display: flex; align-items: center; gap: 8px;
  }
  .req-title::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .req {
    margin: 0; padding: 0; list-style: none;
    overflow-y: auto; -webkit-overflow-scrolling: touch;
    font-size: clamp(15px, 4.3vw, 19px); line-height: 1.62; color: #dbe4f5;
    max-height: 34dvh;
  }
  .req li { position: relative; padding-left: 1.15em; margin-bottom: .3em; }
  .req li::before {
    content: ""; position: absolute; left: .28em; top: .66em;
    width: 5px; height: 5px; border-radius: 50%; background: #4b7fd6;
  }
  .req li.no-dot { padding-left: 0; }
  .req li.no-dot::before { display: none; }
  .req::-webkit-scrollbar { width: 3px; }
  .req::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, .18); border-radius: 3px; }

  .contact { margin-top: 4px; display: flex; flex-direction: column; gap: 7px; }
  .row {
    display: flex; align-items: flex-start; gap: 9px;
    font-size: clamp(14px, 4vw, 17px); color: #c2cfe6; line-height: 1.45;
  }
  .row .ic { flex: none; opacity: .85; }
  .phone { font-family: ui-monospace, Consolas, monospace; letter-spacing: .02em; color: #eaf1ff; }

  /* ---------- 底部进度 + 控件 ---------- */
  .bottom {
    padding: 10px 20px calc(14px + var(--safe-b));
    transition: opacity .35s ease;
  }
  .bar-wrap { height: 4px; border-radius: 4px; background: rgba(255, 255, 255, .1); overflow: hidden; }
  .bar {
    height: 100%; width: 100%; border-radius: 4px;
    background: linear-gradient(90deg, #60a5fa, #a78bfa);
    transform: scaleX(0); transform-origin: left center;
  }
  .controls {
    margin-top: 12px; display: flex; align-items: center; gap: 6px;
    font-size: 13px; color: var(--dim); white-space: nowrap;
  }
  .controls button, .controls select {
    appearance: none; -webkit-appearance: none;
    background: rgba(255, 255, 255, .07); color: var(--fg);
    border: 1px solid var(--line); border-radius: 10px;
    height: 38px; min-width: 38px; padding: 0 10px;
    font-size: 15px; cursor: pointer; font-family: inherit;
  }
  .controls button:active { background: rgba(255, 255, 255, .16); }
  .controls .main { min-width: 48px; background: rgba(59, 130, 246, .22); border-color: rgba(96, 165, 250, .45); }
  .controls .iv { display: flex; align-items: center; gap: 5px; flex: none; white-space: nowrap; }
  .controls select { padding-right: 4px; font-size: 13px; }
  .controls .sp { flex: 1 1 auto; min-width: 0; }
  .controls .back {
    flex: none; color: var(--dim); text-decoration: none; font-size: 13px;
    padding: 0 10px; height: 38px; line-height: 36px; border-radius: 10px;
    border: 1px solid var(--line); white-space: nowrap;
  }
  .controls .back:hover { color: var(--fg); }

  /* 无操作 4 秒后隐藏控件（直播画面更干净），点一下或按任意键恢复 */
  body.idle .topbar, body.idle .bottom { opacity: 0; pointer-events: none; }
  body.idle { cursor: none; }

  .hint {
    position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%);
    font-size: 12px; color: rgba(255, 255, 255, .45);
    background: rgba(0, 0, 0, .35); padding: 6px 12px; border-radius: 999px;
    opacity: 0; transition: opacity .3s ease; pointer-events: none; white-space: nowrap;
  }
  body.show-hint .hint { opacity: 1; }

  .empty { margin: auto; text-align: center; color: var(--dim); font-size: 15px; padding: 40px; }
  .empty a { color: #93c5fd; }
</style>
</head>
<body>
<div class="stage" id="stage">
  <div class="topbar">
    <span class="dot"></span>
    <span>直播招聘 · 自动轮播</span>
    <span class="counter"><b id="cur">1</b> / <span id="total">${o.items.length}</span></span>
  </div>

  <div class="viewport" id="viewport">${body}
  </div>

  <div class="bottom">
    <div class="bar-wrap"><div class="bar" id="bar"></div></div>
    <div class="controls">
      <button id="prev" title="上一条（←）" aria-label="上一条">⏮</button>
      <button id="play" class="main" title="暂停 / 继续（空格）" aria-label="暂停">⏸</button>
      <button id="next" title="下一条（→）" aria-label="下一条">⏭</button>
      <label class="iv">间隔
        <select id="interval" aria-label="切换间隔">${options}</select>
      </label>
      <span class="sp"></span>
      <button id="fs" title="全屏" aria-label="全屏">⛶</button>
      <a class="back" href="${h(back)}" title="返回列表">←</a>
    </div>
  </div>

  <div class="hint" id="hint"></div>
</div>

<script>
(function () {
  var items = ${o.items.length};
  var track = document.getElementById('track');
  var bar = document.getElementById('bar');
  var cur = document.getElementById('cur');
  var btnPlay = document.getElementById('play');
  var sel = document.getElementById('interval');
  var hint = document.getElementById('hint');
  if (!track || items === 0) return;

  var idx = 0;
  var interval = Math.max(2, parseInt(sel.value, 10) || 8) * 1000;
  var playing = true;
  var raf = null;
  var startedAt = 0;
  var elapsed = 0;
  var wakeLock = null;

  /* ---------- 长文本自适应：超出可视高度就逐级缩小字号 ---------- */
  function fit() {
    var reqs = document.querySelectorAll('.req[data-fit]');
    for (var i = 0; i < reqs.length; i++) {
      var el = reqs[i];
      el.style.fontSize = '';
      var base = parseFloat(getComputedStyle(el).fontSize);
      var size = base;
      // 只在真的溢出时缩小，最多缩到 12px
      while (el.scrollHeight > el.clientHeight + 2 && size > 12) {
        size -= 1;
        el.style.fontSize = size + 'px';
      }
    }
  }

  /* ---------- 进度与自动切换 ---------- */
  function paint() {
    elapsed = performance.now() - startedAt;   // 每帧都要重算，否则永远停在 0
    var p = Math.min(1, elapsed / interval);
    bar.style.transform = 'scaleX(' + p + ')';
    if (p >= 1 && playing) {
      go(idx + 1);
      return;
    }
    if (playing) raf = requestAnimationFrame(paint);
  }

  function startTimer(reset) {
    cancelAnimationFrame(raf);
    if (reset) { startedAt = performance.now(); elapsed = 0; }
    bar.style.transform = 'scaleX(' + Math.min(1, elapsed / interval) + ')';
    if (!playing) return;
    startedAt = performance.now() - elapsed;
    raf = requestAnimationFrame(paint);
  }

  function go(i) {
    idx = (i + items) % items;
    track.style.transform = 'translateX(' + (-idx * 100) + '%)';
    cur.textContent = idx + 1;
    elapsed = 0;
    startTimer(true);
  }

  function setPlaying(v) {
    playing = v;
    btnPlay.textContent = v ? '⏸' : '▶';
    btnPlay.setAttribute('aria-label', v ? '暂停' : '继续');
    if (v) { startTimer(false); lockScreen(); }
    else { cancelAnimationFrame(raf); elapsed = performance.now() - startedAt; }
  }

  /* ---------- 常亮（防止直播时手机自动锁屏） ---------- */
  function lockScreen() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (w) {
      wakeLock = w;
      w.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* 不支持或被拒绝，忽略 */ });
  }

  /* ---------- 控件自动隐藏 ---------- */
  var idleTimer = null;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (playing) document.body.classList.add('idle');
    }, 4000);
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) {
    document.addEventListener(ev, wake, { passive: true });
  });
  wake();

  function toast(msg) {
    hint.textContent = msg;
    document.body.classList.add('show-hint');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { document.body.classList.remove('show-hint'); }, 1400);
  }

  /* ---------- 交互 ---------- */
  document.getElementById('prev').addEventListener('click', function () { go(idx - 1); });
  document.getElementById('next').addEventListener('click', function () { go(idx + 1); });
  btnPlay.addEventListener('click', function () { setPlaying(!playing); });

  sel.addEventListener('change', function () {
    interval = Math.max(2, parseInt(sel.value, 10) || 8) * 1000;
    var u = new URL(location.href);
    u.searchParams.set('interval', String(interval / 1000));
    history.replaceState(null, '', u);
    startTimer(true);
    toast('切换间隔 ' + interval / 1000 + ' 秒');
  });

  document.getElementById('fs').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () {});
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { go(idx - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { go(idx + 1); e.preventDefault(); }
    else if (e.key === ' ' || e.code === 'Space') { setPlaying(!playing); e.preventDefault(); }
    else if (e.key === 'f' || e.key === 'F') { document.getElementById('fs').click(); }
  });

  /* 左右滑动（竖着滑交给岗位要求的滚动） */
  var sx = 0, sy = 0, tracking = false;
  var vp = document.getElementById('viewport');
  vp.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; tracking = true; });
  vp.addEventListener('pointerup', function (e) {
    if (!tracking) return;
    tracking = false;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(idx + (dx < 0 ? 1 : -1));
  });
  vp.addEventListener('pointercancel', function () { tracking = false; });

  /* 页面切到后台就停，回来再继续，避免手机锁屏后回来乱跳 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(raf); }
    else if (playing) { startTimer(false); lockScreen(); }
  });

  fit();
  window.addEventListener('resize', fit);
  startTimer(true);
})();
</script>
</body>
</html>`;
}

// --------------------------------------------------------------------------- //
// 微信发布（生成可粘贴到公众号的 HTML）
// --------------------------------------------------------------------------- //
export function wechatPage(o: LayoutOpts & {
  variants: Record<string, string>;
  themes: { key: string; name: string; brand: string; bg: string; soft: string; line: string }[];
  count: number;
  downloadName: string;
}): string {
  const first = o.themes[0];
  const firstHtml = o.variants[first.key] || '';
  const swatches = o.themes.map((t) =>
    `<button type="button" class="wx-theme" data-theme="${h(t.key)}" style="--c:${h(t.brand)};--bg:${h(t.bg)};">`
    + '<span class="wx-dot"></span>'
    + `<span class="wx-theme-name">${h(t.name)}</span></button>`).join('');

  const body = `
  <div class="page-head">
    <div>
      <h1>复制到公众号</h1>
      <p class="sub">已生成 <b>${o.count}</b> 条招聘信息的公众号排版，选好配色后一键复制</p>
    </div>
    <div class="head-actions"><a class="btn" href="/">返回列表</a></div>
  </div>

  <div class="notice">
    <span class="notice-ic">💡</span>
    <div><b>三步搞定：</b>① 选一套配色；② 点「复制到剪贴板」；③ 打开公众号编辑器，在正文里 <b>Ctrl+V</b> 粘贴，排版与配色都会保留。
    <br>公众号不接受外部图片链接，二维码 / 图片请在编辑器里手动插入。</div>
  </div>

  <div class="card wx-theme-card">
    <div class="wx-theme-head">
      <span class="wx-theme-title">配色</span>
      <span class="wx-theme-sub">4 套预设，也可以自定义主色；复制时取当前配色</span>
    </div>
    <div class="wx-themes" id="wxThemes">
      ${swatches}
      <label class="wx-theme wx-theme-custom" id="wxCustomBox">
        <input type="color" id="wxCustom" class="wx-color" value="${h(first.brand)}" title="自定义主色">
        <span class="wx-theme-name">自定义</span>
      </label>
    </div>
  </div>

  <div class="wx-tools">
    <button class="btn btn-primary" id="btnCopy" type="button">📋 复制到剪贴板</button>
    <button class="btn btn-soft" id="btnCode" type="button">🧾 复制 HTML 源码</button>
    <button class="btn btn-ghost" id="btnDownload" type="button">⬇ 下载 .html</button>
    <span class="wx-tip" id="wxTip">复制后到公众号编辑器正文里 Ctrl+V 粘贴</span>
  </div>

  <div class="card wx-card">
    <h3 class="card-title">效果预览（手机宽度）</h3>
    <div class="wx-preview" id="wxPreview">
${firstHtml}
    </div>
  </div>

  <details class="card wx-code-card">
    <summary>查看 HTML 源码（<span id="wxLen">${firstHtml.length}</span> 字符）</summary>
    <textarea id="wxCode" class="wx-code" readonly spellcheck="false">${h(firstHtml)}</textarea>
  </details>

<script>
(function () {
  var VARIANTS = ${jsJson(o.variants)};
  var META = ${jsJson(o.themes)};
  var MAP = {};
  META.forEach(function (m) { MAP[m.key] = m; });

  var preview = document.getElementById('wxPreview');
  var codeEl = document.getElementById('wxCode');
  var lenEl = document.getElementById('wxLen');
  var tip = document.getElementById('wxTip');
  var customBox = document.getElementById('wxCustomBox');
  var customInput = document.getElementById('wxCustom');
  var buttons = [].slice.call(document.querySelectorAll('.wx-theme[data-theme]'));
  var NAME = ${jsJson(o.downloadName)};
  var KEY = 'wx_theme';

  var state = { key: META[0].key, html: VARIANTS[META[0].key], base: META[0].key };

  function say(msg, ok) {
    tip.textContent = msg;
    tip.className = 'wx-tip' + (ok ? ' ok' : ' err');
    setTimeout(function () { tip.className = 'wx-tip'; }, 6000);
  }

  function paint(key, html) {
    state.key = key;
    state.html = html;
    preview.innerHTML = html;
    codeEl.value = html;
    lenEl.textContent = html.length;
    buttons.forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-theme') === key);
    });
    customBox.classList.toggle('on', key === 'custom');
  }

  function remember(val) {
    try { localStorage.setItem(KEY, val); } catch (e) { /* 隐私模式下忽略 */ }
  }

  /* ---- 自定义主色：把预设配色里的 4 个色值整体换掉 ---- */
  function hex2rgb(x) {
    x = String(x).replace('#', '');
    if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  function rgb2hex(rgb) {
    return '#' + rgb.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  function mix(a, b, t) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return rgb2hex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; }));
  }
  function luma(x) {
    var c = hex2rgb(x);
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  }
  function recolor(base, color) {
    var m = MAP[base] || META[0];
    var brand = String(color).toLowerCase();
    if (luma(brand) > 0.72) brand = mix(brand, '#000000', 0.4);
    var map = {};
    map[m.brand.toLowerCase()] = brand;
    map[m.bg.toLowerCase()] = mix(brand, '#ffffff', 0.92);
    map[m.soft.toLowerCase()] = mix(brand, '#8a8a8a', 0.55);
    map[m.line.toLowerCase()] = mix(brand, '#ffffff', 0.78);
    var re = new RegExp(Object.keys(map).join('|'), 'g');
    return VARIANTS[base].replace(re, function (t) { return map[t.toLowerCase()]; });
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-theme');
      state.base = key;
      paint(key, VARIANTS[key]);
      remember(key);
    });
  });

  customInput.addEventListener('input', function () {
    paint('custom', recolor(state.base, customInput.value));
    remember('custom:' + customInput.value);
  });

  /* 记住上次选的配色 */
  (function restore() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
    if (!saved) { return; }
    if (VARIANTS[saved]) {
      state.base = saved;
      paint(saved, VARIANTS[saved]);
    } else if (saved.indexOf('custom:') === 0) {
      var color = saved.slice(7);
      if (/^#[0-9a-f]{6}$/i.test(color)) {
        customInput.value = color;
        paint('custom', recolor(state.base, color));
      }
    }
  })();

  /* 首次进入：默认配色也要显示成「选中」 */
  paint(state.key, state.html);

  /* ---- 复制 ---- */
  function selectNode(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function legacyCopy() {
    selectNode(preview);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    say(ok ? '已复制，去公众号编辑器里 Ctrl+V 粘贴即可'
           : '浏览器拦截了自动复制，已选中预览内容，请按 Ctrl+C', ok);
  }

  document.getElementById('btnCopy').addEventListener('click', function () {
    var html = state.html;
    if (!html) { return; }
    if (navigator.clipboard && window.ClipboardItem) {
      var item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([preview.innerText], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(function () {
        say('已复制到剪贴板，去公众号编辑器里 Ctrl+V 粘贴即可', true);
      }).catch(legacyCopy);
    } else {
      legacyCopy();
    }
  });

  document.getElementById('btnCode').addEventListener('click', function () {
    codeEl.select();
    codeEl.setSelectionRange(0, codeEl.value.length);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.html).then(function () {
        say('HTML 源码已复制到剪贴板', true);
      }).catch(function () {
        document.execCommand('copy');
        say('已复制 HTML 源码', true);
      });
    } else {
      document.execCommand('copy');
      say('已复制 HTML 源码', true);
    }
  });

  document.getElementById('btnDownload').addEventListener('click', function () {
    var doc = '<!DOCTYPE html>\\n<html lang="zh-CN">\\n<head>\\n<meta charset="utf-8">\\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\\n'
      + '<title>微信发布</title>\\n</head>\\n'
      + '<body style="margin:0;padding:20px 16px;background:#fff;">\\n'
      + state.html + '\\n</body>\\n</html>\\n';
    var blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = NAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    say('已开始下载 ' + NAME, true);
  });
})();
</script>`;

  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 新增 / 编辑
// --------------------------------------------------------------------------- //
export function formPage(o: LayoutOpts & {
  mode: 'add' | 'edit'; rec: Record<string, any>; rid?: number;
}): string {
  const isAdd = o.mode === 'add';
  const input = (key: string, label: string, ph: string, max: number, req = false) => `
    <label class="field">
      <span class="label">${label}${req ? ' <i class="req-mark">*</i>' : ''}</span>
      <input type="text" name="${key}" value="${h(o.rec[key] ?? '')}"
             placeholder="${h(ph)}" maxlength="${max}" ${req ? 'required' : ''}>
    </label>`;

  const body = `
  <div class="page-head">
    <div>
      <h1>${isAdd ? '新增招聘信息' : '编辑招聘信息'}</h1>
      <p class="sub">${isAdd ? '填写后保存，可立即生成单页 Word 简章' : `编号 ${o.rid} · 修改后保存`}</p>
    </div>
    <div class="head-actions"><a class="btn" href="/">返回列表</a></div>
  </div>

  <form class="card form-card" method="post" action="${isAdd ? '/add' : `/edit/${o.rid}`}">
    <input type="hidden" name="_csrf" value="${h(o.csrf)}">
    <div class="grid-2">
      ${input('company_name', '用人单位名称', '例如：星辰精密机械有限公司', 120, true)}
      ${input('position', '招聘岗位', '例如：数控车床操作工', 120, true)}
      ${input('headcount', '招聘数（人）', '例如：6（也可填「若干」）', 40)}
      ${input('salary', '工资待遇（元）', '例如：6000-9000', 80)}
      ${input('address', '地址', '例如：经济技术开发区兴业路 88 号', 200)}
      ${input('phone', '联系电话', '例如：0571-88886666 / 13800001234', 80)}
    </div>
    <div class="grid-2">
      <label class="field">
        <span class="label">招聘状态 <small>（默认「招聘中」，发布满 1 个月自动失效）</small></span>
        <select name="status">
          ${STATUS_OPTIONS.map((s) => `<option value="${s.key}"${
    s.key === normStatus(o.rec.status) ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span class="label">发布日期 <small>（默认当天，可改）</small></span>
        <input type="date" name="publish_date"
               value="${h(o.rec.publish_date || todayIso())}" min="2000-01-01" max="2099-12-31">
      </label>
    </div>
    <label class="field">
      <span class="label">岗位要求 <small>（每行一条，Word 中将按行分段排版）</small></span>
      <textarea name="requirements" rows="10"
        placeholder="1. 年龄 20-45 周岁，身体健康；&#10;2. 中专及以上学历；&#10;3. 有相关经验者优先。">${h(o.rec.requirements ?? '')}</textarea>
    </label>
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">保存</button>
      ${isAdd
        ? '<button class="btn btn-soft" type="submit" name="then" value="docx">保存并生成 Word</button>'
        : `<a class="btn btn-soft" href="/docx/${o.rid}">生成 Word 简章</a>`}
      <a class="btn btn-ghost" href="/">取消</a>
    </div>
  </form>`;
  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 导入
// --------------------------------------------------------------------------- //
export function importPage(o: LayoutOpts & {
  result?: { inserted: number; errors: string[]; skipped: number; filename: string } | null;
}): string {
  const r = o.result;
  const resultBlock = r ? `
  <div class="card result-card">
    <h3 class="card-title">导入结果 · ${h(r.filename)}</h3>
    <div class="stat-row">
      <div class="stat ok"><span class="num">${r.inserted}</span><span class="txt">成功导入</span></div>
      <div class="stat warn"><span class="num">${r.skipped}</span><span class="txt">空行跳过</span></div>
      <div class="stat err"><span class="num">${r.errors.length}</span><span class="txt">异常行</span></div>
    </div>
    ${r.errors.length ? `<div class="err-list"><p class="err-title">以下行未能导入：</p>
      <ul>${r.errors.map((e) => `<li>${h(e)}</li>`).join('')}</ul></div>` : ''}
    <div class="form-actions">
      <a class="btn btn-primary" href="/">查看招聘列表</a>
      <a class="btn btn-soft" href="/docx/zip">批量生成 Word</a>
    </div>
  </div>` : '';

  const body = `
  <div class="page-head">
    <div>
      <h1>从 Excel 导入招聘信息</h1>
      <p class="sub">支持 .xlsx / .xlsm / .csv，表头名称可容错识别，导入后自动写入数据库</p>
    </div>
    <div class="head-actions">
      <a class="btn" href="/template.xlsx">下载导入模板</a>
      <a class="btn" href="/">返回列表</a>
    </div>
  </div>

  <div class="grid-2-wide">
    <form class="card form-card" method="post" action="/import" enctype="multipart/form-data">
      <input type="hidden" name="_csrf" value="${h(o.csrf)}">
      <h3 class="card-title">上传文件</h3>
      <div class="dropzone" id="dropzone">
        <input type="file" name="file" id="file" accept=".xlsx,.xlsm,.csv" required>
        <div class="dz-hint">
          <div class="dz-icon">📊</div>
          <p><b>点击选择</b> 或把 Excel 文件拖到此处</p>
          <p class="dz-file" id="dzFile">未选择文件</p>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">开始导入</button>
        <a class="btn btn-ghost" href="/template.xlsx">先下载模板</a>
      </div>
    </form>

    <div class="card">
      <h3 class="card-title">导入规则说明</h3>
      <ul class="tips">
        <li>第 1 行为表头，<b>「用人单位名称」「招聘岗位」为必填列</b>，其余列可留空。</li>
        <li>表头名称支持常见写法，例如 <span class="code">公司名称 / 单位名称 / 岗位 / 职位 / 人数 / 薪资 / 工资 / 电话 / 工作地点</span> 等均可识别。</li>
        <li>「岗位要求」单元格内可换行填写多条要求（Excel 中按 Alt+Enter）。</li>
        <li>整行为空的行会自动跳过；单位名称或岗位为空的行会跳过并提示行号。</li>
        <li>导入为<b>追加</b>模式，不会覆盖数据库中已有数据。</li>
        <li><b>.xls</b> 旧格式请先用 Excel 另存为 .xlsx 再导入。</li>
      </ul>
    </div>
  </div>
  ${resultBlock}
  <script>
    const input = document.getElementById('file');
    const dz = document.getElementById('dropzone');
    const dzFile = document.getElementById('dzFile');
    input.addEventListener('change', () => {
      dzFile.textContent = input.files.length ? input.files[0].name : '未选择文件';
      dz.classList.toggle('has-file', input.files.length > 0);
    });
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.add('dragging');
    }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.remove('dragging');
    }));
    dz.addEventListener('drop', e => {
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        dzFile.textContent = input.files[0].name;
        dz.classList.add('has-file');
      }
    });
  </script>`;
  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 登录 / 注册 / 改密
// --------------------------------------------------------------------------- //
export function loginPage(o: LayoutOpts & { nextUrl: string; username: string }): string {
  const body = `
  <div class="auth-wrap">
    <form class="card auth-card" method="post" action="/login" autocomplete="off">
      <div class="auth-head">
        <div class="auth-icon">🔐</div>
        <h1>管理员登录</h1>
        <p class="sub">新增招聘、导入 / 导出 Excel、批量生成 Word 等数据操作需登录后使用</p>
      </div>
      <input type="hidden" name="_csrf" value="${h(o.csrf)}">
      <input type="hidden" name="next" value="${h(o.nextUrl)}">
      <label class="field">
        <span class="label">账号</span>
        <input type="text" name="username" value="${h(o.username)}" required autofocus maxlength="60" placeholder="请输入账号">
      </label>
      <label class="field">
        <span class="label">密码</span>
        <input type="password" name="password" required maxlength="128" placeholder="请输入登录密码">
      </label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">登录</button>
        ${o.allowRegister ? '<a class="btn btn-soft" href="/register">注册新账号</a>' : ''}
        <a class="btn btn-ghost" href="/">返回列表</a>
      </div>
      <p class="auth-tip">
        连续输错 5 次将锁定 5 分钟。
        新注册的账号需管理员在「用户管理」中审批通过后才能登录。
      </p>
    </form>
    <ul class="auth-note">
      <li><b>公开可访问</b>：招聘列表、网页打印预览、单条 Word 简章下载。</li>
      <li><b>需登录</b>：新增 / 编辑 / 删除、导入 Excel、导出 Excel、批量生成 Word、导入模板。</li>
      <li><b>需管理员</b>：账号审批、停用 / 删除账号、操作日志。</li>
      <li>登录状态默认保持 8 小时，关闭浏览器或点击「退出」即失效。</li>
    </ul>
  </div>`;
  return layout(o, body);
}

export function registerPage(o: LayoutOpts & {
  form: Record<string, string>;
}): string {
  const f = o.form;
  const body = `
  <div class="auth-wrap auth-wide">
    <form class="card auth-card" method="post" action="/register" autocomplete="off">
      <div class="auth-head">
        <div class="auth-icon">📝</div>
        <h1>申请注册账号</h1>
        <p class="sub">注册后需<b>管理员审批</b>，审批通过才能使用新增招聘、导入 / 导出 Excel、批量生成 Word 等功能</p>
      </div>
      <input type="hidden" name="_csrf" value="${h(o.csrf)}">
      <div class="grid-2">
        <label class="field">
          <span class="label">登录账号 <i class="req-mark">*</i></span>
          <input type="text" name="username" value="${h(f.username)}" required minlength="3" maxlength="30"
                 autofocus placeholder="字母 / 数字，3-30 位">
        </label>
        <label class="field">
          <span class="label">真实姓名 <i class="req-mark">*</i></span>
          <input type="text" name="real_name" value="${h(f.real_name)}" required maxlength="40" placeholder="便于管理员核对身份">
        </label>
        <label class="field">
          <span class="label">联系电话 <i class="req-mark">*</i></span>
          <input type="text" name="phone" value="${h(f.phone)}" required maxlength="40" placeholder="手机号或办公电话">
        </label>
        <label class="field">
          <span class="label">所在单位 / 部门 <small>（选填）</small></span>
          <input type="text" name="remark" value="${h(f.remark)}" maxlength="120" placeholder="例如：县就业服务中心">
        </label>
        <label class="field">
          <span class="label">设置密码 <i class="req-mark">*</i></span>
          <input type="password" name="password" required minlength="6" maxlength="128" placeholder="至少 6 位">
        </label>
        <label class="field">
          <span class="label">确认密码 <i class="req-mark">*</i></span>
          <input type="password" name="confirm_password" required minlength="6" maxlength="128" placeholder="再输入一次">
        </label>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">提交注册申请</button>
        <a class="btn btn-ghost" href="/login">已有账号，去登录</a>
      </div>
      <p class="auth-tip">
        提交后账号状态为「待审批」，管理员在「用户管理」中通过后即可登录；
        密码以 PBKDF2 加盐哈希存储，管理员也看不到你的明文密码。
      </p>
    </form>
    <ul class="auth-note">
      <li><b>谁能审批</b>：管理员账号登录后，在「用户管理」页处理待审批申请。</li>
      <li><b>审批后权限</b>：可新增 / 编辑 / 删除招聘信息、导入导出 Excel、批量生成 Word。</li>
      <li><b>账号安全</b>：管理员可随时停用账号、重置密码；停用后已登录的会话会立即失效。</li>
    </ul>
  </div>`;
  return layout(o, body);
}

export function passwordPage(o: LayoutOpts & { first: boolean }): string {
  const body = `
  <div class="auth-wrap">
    <form class="card auth-card" method="post" action="/password" autocomplete="off">
      <div class="auth-head">
        <div class="auth-icon">🔑</div>
        <h1>${o.first ? '请先修改初始密码' : '修改登录密码'}</h1>
        <p class="sub">${o.first
          ? '为保障招聘数据安全，初始密码必须修改后才能进行数据操作'
          : `账号：${h(o.user?.username)} · 建议使用字母 + 数字 + 符号的组合`}</p>
      </div>
      <input type="hidden" name="_csrf" value="${h(o.csrf)}">
      <label class="field">
        <span class="label">${o.first ? '初始密码' : '当前密码'}</span>
        <input type="password" name="old_password" required maxlength="128" autofocus>
      </label>
      <label class="field">
        <span class="label">新密码 <small>（至少 6 位）</small></span>
        <input type="password" name="new_password" required minlength="6" maxlength="128">
      </label>
      <label class="field">
        <span class="label">确认新密码</span>
        <input type="password" name="confirm_password" required minlength="6" maxlength="128">
      </label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">保存新密码</button>
        ${o.first ? '' : '<a class="btn btn-ghost" href="/">取消</a>'}
      </div>
      <p class="auth-tip">
        密码以 PBKDF2-HMAC-SHA256 加盐哈希方式存储，数据库里看不到明文。
        忘记密码可用初始化命令重置管理员账号。
      </p>
    </form>
  </div>`;
  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 用户管理
// --------------------------------------------------------------------------- //
export function usersPage(o: LayoutOpts & { rows: any[] }): string {
  const { rows } = o;
  const pend = rows.filter((u) => u.status === 'pending');
  const csrf = h(o.csrf);

  const actionForm = (uid: number, action: string, label: string, cls: string, confirm?: string) => `
    <form method="post" action="/users/${uid}/action" class="inline"${confirm ? ` onsubmit="return confirm('${confirm}');"` : ''}>
      <input type="hidden" name="_csrf" value="${csrf}">
      <input type="hidden" name="action" value="${action}">
      <button class="btn btn-xs ${cls}" type="submit">${label}</button>
    </form>`;

  const pendingBlock = pend.length ? `
  <div class="card">
    <h3 class="card-title">待审批申请 · ${pend.length} 个</h3>
    <div class="pending-list">
      ${pend.map((u) => `
      <div class="pending-item">
        <div class="pending-main">
          <div class="pending-name"><b>${h(u.username)}</b><span class="muted-sm">申请于 ${h(u.created_at)}</span></div>
          <div class="pending-meta">
            <span>姓名：${h(u.real_name || '未填')}</span>
            <span>电话：${h(u.phone || '未填')}</span>
            <span>单位：${h(u.remark || '未填')}</span>
          </div>
        </div>
        <div class="pending-ops">
          ${actionForm(u.id, 'approve', '通过', 'btn-primary')}
          ${actionForm(u.id, 'reject', '拒绝', 'btn-danger', `确定拒绝 ${h(u.username)} 的注册申请吗？该账号记录将被删除。`)}
        </div>
      </div>`).join('')}
    </div>
  </div>` : '';

  const me = o.user?.id;
  const rowHtml = rows.map((u) => {
    const isMe = u.id === me;
    let ops = '';
    if (u.status === 'pending') {
      ops = actionForm(u.id, 'approve', '通过', 'btn-primary')
        + actionForm(u.id, 'reject', '拒绝', 'btn-danger', `确定拒绝 ${h(u.username)} 的注册申请吗？`);
    } else {
      if (u.status === 'active') {
        if (!isMe) ops += actionForm(u.id, 'disable', '停用', '', `停用后 ${h(u.username)} 将无法登录，确定吗？`);
      } else {
        ops += actionForm(u.id, 'enable', '启用', 'btn-primary');
      }
      if (u.role === 'admin') {
        if (!isMe) ops += actionForm(u.id, 'demote', '取消管理员', '', `取消 ${h(u.username)} 的管理员权限？`);
      } else {
        ops += actionForm(u.id, 'promote', '设为管理员', '', `将 ${h(u.username)} 设为管理员？管理员可审批账号、查看日志。`);
      }
      ops += actionForm(u.id, 'resetpwd', '重置密码', '', `重置 ${h(u.username)} 的密码？系统会生成一个临时密码。`);
      if (!isMe) ops += actionForm(u.id, 'delete', '删除', 'btn-danger', `删除账号 ${h(u.username)}？此操作不可恢复。`);
    }

    const statusTag = u.status === 'pending' ? '<span class="tag tag-pending">待审批</span>'
      : u.status === 'active' ? '<span class="tag tag-ok">正常</span>'
        : '<span class="tag tag-off">已停用</span>';
    const roleTag = u.role === 'admin'
      ? '<span class="tag tag-admin">管理员</span>' : '<span class="tag">操作员</span>';

    return `<tr class="${isMe ? 'row-me' : ''}">
      <td class="mono">${u.id}</td>
      <td class="strong">${h(u.username)}${isMe ? '<span class="tag tag-me">我</span>' : ''}</td>
      <td>${h(u.real_name || '—')}</td>
      <td class="mono small">${h(u.phone || '—')}</td>
      <td>${roleTag}</td>
      <td>${statusTag}</td>
      <td class="mono small">${h(u.last_login || '从未登录')}</td>
      <td class="small">${u.approved_by ? `${h(u.approved_by)}<br><span class="muted-sm">${h(u.approved_at)}</span>` : '—'}</td>
      <td class="ops">${ops}</td>
    </tr>`;
  }).join('');

  const body = `
  <div class="page-head">
    <div>
      <h1>用户管理</h1>
      <p class="sub">共 ${rows.length} 个账号${pend.length ? `，其中 <b>${pend.length}</b> 个待审批` : ''}
        · 审批通过后该账号即可使用新增招聘、导入导出 Excel、批量生成 Word</p>
    </div>
    <div class="head-actions">
      <a class="btn" href="/audit">操作日志</a>
      <a class="btn" href="/">返回列表</a>
    </div>
  </div>
  ${pendingBlock}
  <h3 class="section-title">全部账号 · ${rows.length} 个</h3>
  <div class="table-card"><table class="data-table">
    <thead><tr>
      <th style="width:56px">编号</th><th style="width:150px">账号</th><th style="width:110px">姓名</th>
      <th style="width:130px">联系电话</th><th style="width:110px">角色</th><th style="width:110px">状态</th>
      <th style="width:160px">最近登录</th><th style="width:180px">审批信息</th><th style="width:300px">操作</th>
    </tr></thead>
    <tbody>${rowHtml}</tbody>
  </table></div>

  <div class="card tips-card">
    <h3 class="card-title">审批与权限说明</h3>
    <ul class="tips">
      <li>新注册账号状态为<b>待审批</b>，未审批前无法登录（登录会提示「正在等待管理员审批」）。</li>
      <li><b>通过</b>后账号立即可用；<b>拒绝</b>会删除该账号记录，申请人可重新提交。</li>
      <li><b>停用</b>的账号无法登录，已登录的会话会在下一次操作时立即失效。</li>
      <li><b>管理员</b>额外拥有：审批账号、停用 / 删除账号、查看操作日志。</li>
      <li>为避免把系统锁死，<b>不能停用 / 删除 / 降级自己</b>，且系统至少保留一个正常状态的管理员。</li>
      <li><b>重置密码</b>会生成随机临时密码并显示一次，该账号下次登录会被强制修改。</li>
    </ul>
  </div>`;
  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 操作日志
// --------------------------------------------------------------------------- //
export function auditPage(o: LayoutOpts & { rows: any[] }): string {
  const rows = o.rows.map((r) => `<tr>
    <td class="mono">${r.id}</td>
    <td class="mono small">${h(r.ts)}</td>
    <td class="strong">${h(r.username || '—')}</td>
    <td><span class="tag">${h(r.action)}</span></td>
    <td class="small">${h(r.detail || '—')}</td>
    <td class="mono small">${h(r.ip || '—')}</td>
  </tr>`).join('');

  const body = `
  <div class="page-head">
    <div>
      <h1>操作日志</h1>
      <p class="sub">记录登录、退出、注册、审批、新增、修改、删除、导入导出等操作，最近 300 条</p>
    </div>
    <div class="head-actions"><a class="btn" href="/">返回列表</a></div>
  </div>
  ${o.rows.length ? `<div class="table-card"><table class="data-table">
    <thead><tr>
      <th style="width:70px">编号</th><th style="width:170px">时间</th><th style="width:120px">操作人</th>
      <th style="width:130px">操作类型</th><th>详情</th><th style="width:140px">来源 IP</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>` : `<div class="empty"><div class="empty-icon">🗂️</div>
    <h3>暂无操作记录</h3><p>登录或修改招聘信息后，这里会出现对应日志。</p></div>`}`;
  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 打印预览（独立页面）
// --------------------------------------------------------------------------- //
export function previewPage(info: DocInfo, user: UserLike | null): string {
  const editLink = user ? `<a href="/edit/${info.id}">编辑</a>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>招聘简章预览 · ${h(info.company)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef1f6; font-family: "宋体", SimSun, serif; color: #000; }
  .toolbar {
    position: sticky; top: 0; z-index: 5; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; padding: 10px 22px;
    background: #fff; border-bottom: 1px solid #e3e7ef;
    font-family: "Microsoft YaHei", sans-serif; font-size: 13.5px;
  }
  .toolbar .t-left { color: #6b7280; }
  .toolbar b { color: #1f2430; }
  .toolbar .t-right { display: flex; gap: 8px; }
  .toolbar a, .toolbar button {
    display: inline-flex; align-items: center; height: 34px; padding: 0 14px;
    border: 1px solid #e3e7ef; border-radius: 8px; background: #fff;
    color: #374151; text-decoration: none; font-size: 13.5px; cursor: pointer; font-family: inherit;
  }
  .toolbar a:hover, .toolbar button:hover { border-color: #c9d2e3; color: #2f5597; }
  .toolbar .primary { background: #2f5597; border-color: #2f5597; color: #fff; font-weight: 600; }
  .toolbar .primary:hover { background: #24437a; color: #fff; }
  .paper-wrap { padding: 22px 12px 40px; display: flex; justify-content: center; }
  .sheet {
    width: 21cm; min-height: 29.7cm; padding: 2.0cm 2.4cm 1.8cm; background: #fff;
    box-shadow: 0 6px 24px rgba(16, 24, 40, .12);
    font-size: ${info.bodyPt}pt; line-height: 1.28;
  }
  .doc-no { text-align: right; font-size: 9pt; color: #888; margin: 0 0 3pt; }
  h1 { margin: 0 0 3pt; text-align: center; font-family: "黑体", SimHei, sans-serif;
       font-size: 22pt; font-weight: 700; letter-spacing: 2pt; }
  .company { margin: 0 0 2pt; text-align: center; font-family: "黑体", SimHei, sans-serif;
             font-size: 13.5pt; font-weight: 700; }
  .rule { border: 0; border-bottom: 1.5pt solid #333; margin: 0 0 8pt; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 0.75pt solid #404040; padding: 2.5pt 5pt; vertical-align: middle; }
  th { width: 3.7cm; background: #f2f2f2; text-align: center; font-weight: 700; }
  td { word-break: break-word; }
  td.bold { font-weight: 700; }
  td.top { vertical-align: top; }
  td p { margin: 0; }
  .note { margin: 10pt 0 0; text-indent: 2em; line-height: 1.45; }
  .sign { margin: 8pt 0 0; text-align: right; line-height: 1.5; }
  .qr-block { margin: 12pt 0 0; text-align: center; }
  .qr-block img { width: 2.8cm; height: 2.8cm; display: block; margin: 0 auto; }
  .qr-block p { margin: 4pt 0 0; font-size: 9pt; color: #404040; }
  .foot-note { margin: 8pt 0 0; text-align: center; font-size: 8.5pt; color: #808080; }
  @page { size: A4; margin: 0; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none !important; }
    .paper-wrap { padding: 0; }
    .sheet { box-shadow: none; margin: 0; width: auto; min-height: auto; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <div class="t-left">招聘简章预览 · <b>${h(info.company)} — ${h(info.position)}</b></div>
  <div class="t-right">
    <a href="/">返回列表</a>
    ${editLink}
    <a class="primary" href="/docx/${info.id}">下载 Word</a>
    <button onclick="window.print()">打印</button>
  </div>
</div>
<div class="paper-wrap"><div class="sheet">
  <p class="doc-no">编号：ZP-${info.year}-${String(info.id).padStart(4, '0')}</p>
  <h1>招 聘 简 章</h1>
  <p class="company">${h(info.company)}</p>
  <hr class="rule">
  <table>
    <tr><th>招聘岗位</th><td class="bold">${h(info.position)}</td></tr>
    <tr><th>招聘人数</th><td>${h(info.headcount)}</td></tr>
    <tr><th>工资待遇</th><td class="bold">${h(info.salary)}</td></tr>
    <tr><th>工作地址</th><td>${h(info.address)}</td></tr>
    <tr><th>联系电话</th><td>${h(info.phone)}</td></tr>
    <tr><th>岗位要求</th><td class="top">${info.reqLines.map((l) => `<p>${h(l)}</p>`).join('')}</td></tr>
  </table>
  <p class="note">有意应聘者请携带本人身份证及相关证件，于工作日到上述地址报名面试，或来电咨询。本简章长期有效，招满为止。</p>
  <p class="sign">发布单位：${h(info.company)}（盖章）</p>
  <p class="sign">发布日期：${info.today.year} 年 ${info.today.month} 月 ${info.today.day} 日</p>
  ${info.hasQr ? `<div class="qr-block"><img src="/qr.jpg" alt="扫码关注"><p>${h(QR_CAPTION)}</p></div>` : ''}
  <p class="foot-note">— 本招聘简章最终解释权归用人单位所有 —</p>
</div></div>
</body>
</html>`;
}

// --------------------------------------------------------------------------- //
// 首次初始化（创建管理员）
// --------------------------------------------------------------------------- //
export function setupPage(
  o: LayoutOpts, token: string, form: Record<string, string>, error = '',
): string {
  const body = `
  <div class="auth-wrap">
    <form class="card auth-card" method="post" action="/setup?token=${encodeURIComponent(token)}" autocomplete="off">
      <div class="auth-head">
        <div class="auth-icon">🚀</div>
        <h1>初始化管理员账号</h1>
        <p class="sub">数据库里还没有任何账号，先创建一个管理员，之后即可登录并审批其他注册申请</p>
      </div>
      <input type="hidden" name="_csrf" value="${h(o.csrf)}">
      <input type="hidden" name="token" value="${h(token)}">
      ${error ? `<div class="flash error">${h(error)}</div>` : ''}
      <label class="field">
        <span class="label">管理员账号</span>
        <input type="text" name="username" value="${h(form.username || 'admin')}" required
               minlength="3" maxlength="30" autofocus>
      </label>
      <label class="field">
        <span class="label">密码 <small>（至少 8 位，建议字母 + 数字 + 符号）</small></span>
        <input type="password" name="password" required minlength="8" maxlength="128">
      </label>
      <label class="field">
        <span class="label">确认密码</span>
        <input type="password" name="confirm_password" required minlength="8" maxlength="128">
      </label>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">创建管理员</button>
        <a class="btn btn-ghost" href="/">返回首页</a>
      </div>
      <p class="auth-tip">
        该页面只在数据库没有任何账号时可用，创建成功后会自动失效。
        口令来自环境变量 <span class="code">SETUP_TOKEN</span>，用完建议执行
        <span class="code">wrangler secret delete SETUP_TOKEN</span> 删除。
      </p>
    </form>
  </div>`;
  return layout(o, body);
}

// --------------------------------------------------------------------------- //
// 错误页
// --------------------------------------------------------------------------- //
export function errorPage(
  o: LayoutOpts, code: number, title: string, desc: string, icon = '⚠️',
): string {
  const body = `
  <div class="empty">
    <div class="empty-icon">${icon}</div>
    <h3>${h(title)}</h3>
    <p>${h(desc)}</p>
    <div class="empty-actions">
      <a class="btn btn-primary" href="/">返回招聘列表</a>
      <a class="btn" href="/login">去登录</a>
    </div>
    <p class="muted-sm" style="margin-top:14px">错误码 ${code}</p>
  </div>`;
  return layout(o, body);
}
