/**
 * 服务端渲染的 HTML 页面（模板字符串，无模板引擎依赖）
 */
import { CSS } from './css';
import { DocInfo, FIELD_LABELS, FIELDS, QR_CAPTION } from './format';

export function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  csrf: string;
  user?: UserLike | null;
  isAdmin?: boolean;
  pendingCount?: number;
  allowRegister?: boolean;
  flashes?: [string, string][];
  active?: string;
}

export function layout(o: LayoutOpts, body: string): string {
  const u = o.user;
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
  <a class="brand" href="/"><span class="logo">招</span><span>招聘信息管理系统</span></a>
  <nav class="nav">${nav}</nav>
  <div class="userbox">${userbox}</div>
</div></header>
<main class="wrap main">
  ${u && u.must_change ? '<div class="flash error">当前仍在使用初始密码，存在数据泄露风险，请<a href="/password"><b>立即修改密码</b></a>。</div>' : ''}
  ${flashes}
  ${body}
</main>
<footer class="foot">招聘信息管理系统 · Cloudflare Pages + D1 · 每条招聘信息一键生成单页 A4 Word 简章</footer>
</body>
</html>`;
}

// --------------------------------------------------------------------------- //
// 列表
// --------------------------------------------------------------------------- //
export function indexPage(o: LayoutOpts & {
  rows: any[]; q: string; page: number; pages: number; total: number;
}): string {
  const { rows, q, page, pages, total, user } = o;
  const searchUrl = (p: number) => `/${qs({ q: q || undefined, page: p > 1 ? p : undefined })}`;

  const tableRows = rows.map((r) => `
    <tr>
      <td class="mono">${user ? `<input type="checkbox" class="pick-box" name="ids" value="${r.id}"
        form="selForm" aria-label="选择编号 ${r.id}"> ` : ''}${r.id}</td>
      <td class="strong">${h(r.company_name)}</td>
      <td>${h(r.position)}</td>
      <td class="center">${h(r.headcount || '—')}</td>
      <td class="center salary">${h(r.salary || '面议')}</td>
      <td class="req">${r.requirements
        ? `<div class="req-text" title="${h(r.requirements)}">${h(r.requirements)}</div>` : '—'}</td>
      <td class="small">${h(r.address || '—')}</td>
      <td class="mono">${h(r.phone || '—')}</td>
      <td class="ops">
        <a class="btn btn-xs" href="/preview/${r.id}">预览</a>
        <a class="btn btn-xs btn-primary" href="/docx/${r.id}">Word</a>
        ${user ? `<a class="btn btn-xs" href="/edit/${r.id}">编辑</a>
        <form method="post" action="/delete/${r.id}" class="inline"
              onsubmit="return confirm('确定删除编号 ${r.id}「${h(r.company_name)} - ${h(r.position)}」吗？此操作不可恢复。');">
          <input type="hidden" name="_csrf" value="${h(o.csrf)}">
          <input type="hidden" name="back" value="${h(searchUrl(page))}">
          <button class="btn btn-xs btn-danger" type="submit">删除</button>
        </form>`
        : `<a class="btn btn-xs btn-ghost" href="/login?next=${encodeURIComponent(`/edit/${r.id}`)}" title="编辑与删除需登录">🔒 编辑</a>`}
      </td>
    </tr>`).join('');

  const pager = pages > 1 ? `
    <div class="pager">
      ${page > 1 ? `<a class="btn btn-xs" href="${searchUrl(page - 1)}">上一页</a>` : ''}
      <span class="pager-info">第 ${page} / ${pages} 页</span>
      ${page < pages ? `<a class="btn btn-xs" href="${searchUrl(page + 1)}">下一页</a>` : ''}
    </div>` : '';

  const empty = `
    <div class="empty">
      <div class="empty-icon">📄</div>
      <h3>${q ? `没有匹配「${h(q)}」的招聘信息` : '还没有招聘信息'}</h3>
      <p>可以手动新增一条，或从 Excel 批量导入已有招聘数据。</p>
      <div class="empty-actions">
        <a class="btn btn-primary" href="/add">新增招聘信息</a>
        <a class="btn" href="/import">从 Excel 导入</a>
      </div>
    </div>`;

  const notice = !user ? `
    <div class="notice">
      <span class="notice-ic">🔒</span>
      <div><b>当前为访客浏览模式。</b>招聘列表、打印预览与单条 Word 简章可自由使用；
      新增 / 编辑 / 删除、导入 Excel、导出 Excel、批量生成 Word 需登录后操作。</div>
      <a class="btn btn-xs btn-primary" href="/login">登录</a>
    </div>` : '';

  const selbar = user ? `
  <form id="selForm" method="post" action="/docx/selected" class="selbar">
    <input type="hidden" name="_csrf" value="${h(o.csrf)}">
    <span class="selbar-count">已选 <b id="selCount">0</b> 条</span>
    <button class="btn btn-primary btn-xs" id="selBtn" type="submit" disabled>📄 导出选定为 Word（单文件）</button>
    <span class="selbar-hint">勾选多条后导出到同一个 Word 文件，每条占一页，适合一次打印多张</span>
  </form>` : '';

  const pickScript = user ? `
<script>
(function () {
  var form = document.getElementById('selForm');
  if (!form) return;
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.pick-box'));
  var all = document.getElementById('pickAll');
  var counter = document.getElementById('selCount');
  var btn = document.getElementById('selBtn');
  function picked() { return boxes.filter(function (b) { return b.checked; }); }
  function sync() {
    var n = picked().length;
    counter.textContent = n;
    btn.disabled = n === 0;
    if (all) {
      all.checked = n > 0 && n === boxes.length;
      all.indeterminate = n > 0 && n < boxes.length;
    }
  }
  boxes.forEach(function (b) { b.addEventListener('change', sync); });
  if (all) all.addEventListener('change', function () {
    boxes.forEach(function (b) { b.checked = all.checked; });
    sync();
  });
  form.addEventListener('submit', function (e) { if (!picked().length) e.preventDefault(); });
  sync();
})();
</script>` : '';

  const body = `
  <div class="page-head">
    <div>
      <h1>招聘信息列表</h1>
      <p class="sub">共 <b>${total}</b> 条招聘信息${q ? `（关键词：${h(q)}）` : ''}，每条可直接生成单页 Word 简章打印</p>
    </div>
    <div class="head-actions"><a class="btn btn-primary" href="/add">+ 新增招聘信息</a></div>
  </div>

  <div class="toolbar">
    <form class="search" method="get" action="/">
      <input type="text" name="q" value="${h(q)}" placeholder="搜索单位名称 / 岗位 / 地址 / 电话…">
      <button class="btn" type="submit">搜索</button>
      ${q ? '<a class="btn btn-ghost" href="/">清除</a>' : ''}
    </form>
    <div class="tool-actions">
      <a class="btn btn-soft" href="/docx/zip${qs({ q: q || undefined })}">📦 批量生成 Word（ZIP）</a>
      <a class="btn btn-soft" href="/export/excel${qs({ q: q || undefined })}">⬇ 导出 Excel</a>
      <a class="btn btn-soft" href="/import">⬆ 导入 Excel</a>
    </div>
  </div>
  ${selbar}
  ${notice}
  ${rows.length ? `<div class="table-card"><table class="data-table">
    <thead><tr>
      <th style="width:76px">${user ? '<input type="checkbox" id="pickAll" class="pick-box" title="全选本页" aria-label="全选本页"> ' : ''}编号</th><th style="width:180px">用人单位名称</th>
      <th style="width:140px">招聘岗位</th><th style="width:78px">招聘数</th>
      <th style="width:110px">工资待遇（元）</th><th>岗位要求</th>
      <th style="width:150px">地址</th><th style="width:120px">联系电话</th>
      <th style="width:268px">操作</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div>${pager}` : empty}${pickScript}`;

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
        首次部署请先访问 <span class="code">/setup?token=初始化口令</span> 创建管理员账号。
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
      <th style="width:130px">联系电话</th><th style="width:100px">角色</th><th style="width:100px">状态</th>
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
