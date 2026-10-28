/** 页面样式（与 Flask 版 style.css 一致） */
export const CSS = `:root {
  --bg: #f4f6fa;
  --card: #ffffff;
  --line: #e3e7ef;
  --line-soft: #eef1f6;
  --text: #1f2430;
  --muted: #6b7280;
  --primary: #2f5597;
  --primary-dark: #24437a;
  --primary-soft: #eaf0fb;
  --danger: #c0392b;
  --danger-soft: #fdecea;
  --success: #1e7a46;
  --success-soft: #e8f6ee;
  --warn: #b4761a;
  --warn-soft: #fdf3e3;
  --radius: 10px;
  --shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 6px 18px rgba(16, 24, 40, .05);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }

.wrap { max-width: 1320px; margin: 0 auto; padding: 0 24px; }

/* ---------------- 顶栏 ---------------- */
.topbar {
  background: #fff;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  z-index: 20;
}
.bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  height: 62px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: .3px;
}
.brand:hover { text-decoration: none; }
.logo {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  background: var(--primary);
  color: #fff;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
}
.nav { display: flex; gap: 4px; flex-wrap: wrap; }
.nav a {
  padding: 7px 13px;
  border-radius: 8px;
  color: #4b5563;
  font-size: 13.5px;
}
.nav a:hover { background: var(--line-soft); color: var(--primary); text-decoration: none; }
.nav a.on { background: var(--primary-soft); color: var(--primary); font-weight: 600; }

.main { padding: 26px 24px 60px; min-height: calc(100vh - 130px); }

/* ---------------- 页头 ---------------- */
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.page-head h1 { font-size: 21px; margin: 0 0 4px; font-weight: 700; letter-spacing: .2px; }
.page-head .sub { margin: 0; color: var(--muted); font-size: 13px; }
.page-head .sub b { color: var(--primary); font-size: 15px; }
.head-actions { display: flex; gap: 10px; }

/* ---------------- 按钮 ---------------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 15px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: #374151;
  font-size: 13.5px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: .15s ease;
}
.btn:hover { border-color: #c9d2e3; background: #fbfcfe; text-decoration: none; color: var(--primary); }
.btn:active { transform: translateY(1px); }

.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  font-weight: 600;
}
.btn-primary:hover { background: var(--primary-dark); border-color: var(--primary-dark); color: #fff; }

.btn-soft { background: var(--primary-soft); border-color: #d5e0f5; color: var(--primary); }
.btn-soft:hover { background: #dde8fa; color: var(--primary-dark); }

.btn-ghost { background: transparent; border-color: transparent; color: var(--muted); }
.btn-ghost:hover { background: var(--line-soft); color: var(--text); }

.btn-danger { background: #fff; border-color: #f0c8c4; color: var(--danger); }
.btn-danger:hover { background: var(--danger-soft); border-color: #e6a9a3; color: var(--danger); }

.btn-xs { height: 28px; padding: 0 10px; font-size: 12.5px; border-radius: 6px; }

/* ---------------- 工具条 ---------------- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.search { display: flex; gap: 8px; flex: 1; min-width: 300px; max-width: 560px; }
.search input {
  flex: 1;
  height: 36px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  font-size: 13.5px;
  font-family: inherit;
  color: var(--text);
  outline: none;
  transition: .15s;
}
.search input:focus { border-color: #9db4dd; box-shadow: 0 0 0 3px rgba(47, 85, 151, .1); }
.tool-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ---------------- 表格 ---------------- */
.table-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow-x: auto;          /* 列多了窄屏可横向滚动，不挤压「岗位要求」 */
  overflow-y: hidden;
}
.data-table { width: 100%; min-width: 1270px; border-collapse: collapse; table-layout: fixed; }
.data-table th {
  background: #f8fafd;
  border-bottom: 1px solid var(--line);
  padding: 11px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: #55607a;
  text-align: left;
  letter-spacing: .3px;
  white-space: nowrap;
}
.data-table td {
  padding: 12px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.data-table tbody tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover { background: #fafbfe; }
.data-table .center { text-align: center; }
.data-table .mono { font-family: ui-monospace, Consolas, "Courier New", monospace; color: #566; font-size: 13px; white-space: nowrap; }
.data-table .strong { font-weight: 600; }
.data-table .small { font-size: 12.5px; color: #5b6472; }
.data-table .salary { color: #c0392b; font-weight: 600; }
.data-table .req { color: #4b5563; font-size: 12.8px; }
.req-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
  line-height: 1.5;
}
.ops { white-space: nowrap; padding-left: 8px !important; padding-right: 8px !important; }
.ops .btn { margin-right: 3px; }
/* 招聘状态徽标 */
.st {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  white-space: nowrap;
  border: 1px solid transparent;
}
.st-active { color: #1d7a4d; background: #e8f6ee; border-color: #bfe3ce; }
.st-full { color: #9a5b00; background: #fdf1dd; border-color: #f0d6a6; }
.st-expired { color: #6b7280; background: #eef0f4; border-color: #d8dce4; }
/* 失效行整体淡化，但仍可读 */
.data-table tbody tr.row-expired td { color: #8a93a3; }
.data-table tbody tr.row-expired .salary { color: #b08a86; }
.data-table tbody tr.row-expired .st { opacity: .9; }
.data-table tbody tr.row-full td { background: #fffdf7; }
.ops .btn:last-child { margin-right: 0; }
.inline { display: inline; }
form.inline button { font-family: inherit; }

/* ---------------- 分页 ---------------- */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}
.pager-info { color: var(--muted); font-size: 13px; margin-left: 4px; }
.pager-num {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; height: 28px; padding: 0 7px;
  border: 1px solid var(--line); border-radius: 7px;
  background: #fff; color: var(--text); font-size: 13px; text-decoration: none;
}
.pager-num:hover { border-color: #9db4dd; color: #2f5597; }
.pager-num.on {
  background: #2f5597; border-color: #2f5597; color: #fff; font-weight: 600;
}

/* ---------------- 卡片 / 表单 ---------------- */
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 22px 24px;
}
.card-title { font-size: 15px; margin: 0 0 16px; font-weight: 700; }
.form-card { max-width: 100%; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 22px; }
.grid-2-wide { display: grid; grid-template-columns: 1.35fr 1fr; gap: 18px; align-items: start; }

.field { display: block; margin-bottom: 16px; }
.field .label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #3d4658;
  margin-bottom: 6px;
}
.field .label small { font-weight: 400; color: var(--muted); }
.req-mark { color: var(--danger); font-style: normal; }

.field input[type="text"],
.field input[type="password"],
.field input[type="date"],
.field select,
.field textarea {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 13.5px;
  font-family: inherit;
  color: var(--text);
  background: #fff;
  outline: none;
  transition: .15s;
}
.field textarea { resize: vertical; line-height: 1.7; }
.field input[type="date"] { cursor: pointer; }
.field input[type="text"]:focus,
.field input[type="date"]:focus,
.field input[type="password"]:focus,
.field select:focus,
.field textarea:focus {
  border-color: #9db4dd;
  box-shadow: 0 0 0 3px rgba(47, 85, 151, .1);
}
.form-actions { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; }

/* ---------------- 上传区 ---------------- */
.dropzone {
  position: relative;
  border: 2px dashed #ccd6e8;
  border-radius: var(--radius);
  background: #fbfcff;
  padding: 30px 20px;
  text-align: center;
  transition: .15s;
  margin-bottom: 16px;
}
.dropzone:hover, .dropzone.dragging { border-color: var(--primary); background: var(--primary-soft); }
.dropzone.has-file { border-color: #8ab48f; background: #f6fbf7; }
.dropzone input[type="file"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.dz-icon { font-size: 30px; margin-bottom: 6px; }
.dz-hint p { margin: 3px 0; color: var(--muted); font-size: 13px; }
.dz-file { color: var(--primary); font-weight: 600; font-size: 13px; word-break: break-all; }

.tips { margin: 0; padding-left: 20px; color: #4b5563; font-size: 13px; line-height: 1.9; }
.tips li { margin-bottom: 4px; }
.code {
  background: #f3f5f9;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 12.5px;
  color: #3d4658;
}

/* ---------------- 提示 / 结果 ---------------- */
.flash-area { margin-bottom: 16px; }
.flash {
  padding: 11px 15px;
  border-radius: 8px;
  font-size: 13.5px;
  margin-bottom: 8px;
  border: 1px solid transparent;
}
.flash.success { background: var(--success-soft); color: var(--success); border-color: #c6e6d2; }
.flash.error { background: var(--danger-soft); color: var(--danger); border-color: #f2cdc8; }
.flash.warn { background: var(--warn-soft); color: var(--warn); border-color: #f0dcbc; }

.result-card { margin-top: 18px; }
.stat-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.stat {
  flex: 1;
  min-width: 120px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 16px;
  background: #fbfcfe;
}
.stat .num { display: block; font-size: 24px; font-weight: 700; line-height: 1.2; }
.stat .txt { font-size: 12.5px; color: var(--muted); }
.stat.ok .num { color: var(--success); }
.stat.warn .num { color: var(--warn); }
.stat.err .num { color: var(--danger); }

.err-list {
  background: #fff8f7;
  border: 1px solid #f4d7d3;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.err-title { margin: 0 0 6px; font-weight: 600; color: var(--danger); font-size: 13px; }
.err-list ul { margin: 0; padding-left: 20px; color: #7a3b35; font-size: 12.8px; line-height: 1.8; }

/* ---------------- 空状态 ---------------- */
.empty {
  background: var(--card);
  border: 1px dashed #d5dceb;
  border-radius: var(--radius);
  padding: 60px 20px;
  text-align: center;
}
.empty-icon { font-size: 40px; margin-bottom: 10px; }
.empty h3 { margin: 0 0 6px; font-size: 16px; }
.empty p { margin: 0 0 18px; color: var(--muted); font-size: 13.5px; }
.empty-actions { display: flex; gap: 10px; justify-content: center; }

/* ---------------- 页脚 ---------------- */
.foot {
  text-align: center;
  color: #9aa3b2;
  font-size: 12.5px;
  padding: 18px 24px 26px;
  border-top: 1px solid var(--line);
  background: #fff;
}

/* ---------------- 登录 / 权限 ---------------- */
.userbox { display: flex; align-items: center; gap: 10px; font-size: 13px; white-space: nowrap; }
.userbox .who { display: inline-flex; align-items: center; gap: 6px; color: #3d4658; font-weight: 600; }
.userbox .dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--success); display: inline-block;
}
.link-mini { color: var(--muted); font-size: 12.5px; }
.link-mini:hover { color: var(--primary); text-decoration: none; }
.as-btn {
  background: none; border: none; padding: 0; cursor: pointer;
  font-family: inherit; font-size: 12.5px; color: var(--muted);
}
.as-btn:hover { color: var(--primary); }
.lock { font-size: 10px; margin-left: 3px; opacity: .5; }

.notice {
  display: flex; gap: 10px; align-items: center;
  background: var(--warn-soft); border: 1px solid #f0dcbc; color: #7a5210;
  border-radius: var(--radius); padding: 10px 14px; margin-bottom: 14px;
  font-size: 13px; line-height: 1.65;
}
.notice .notice-ic { font-size: 16px; }
.notice > div { flex: 1; }

.auth-wrap { max-width: 520px; margin: 34px auto 10px; }
.auth-card { padding: 28px 30px 24px; }
.auth-head { text-align: center; margin-bottom: 20px; }
.auth-icon { font-size: 30px; line-height: 1; margin-bottom: 8px; }
.auth-head h1 { margin: 0 0 6px; font-size: 19px; }
.auth-head .sub { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.65; }
.auth-tip {
  margin: 16px 0 0; padding-top: 14px; border-top: 1px dashed var(--line);
  color: var(--muted); font-size: 12.5px; line-height: 1.75;
}
.auth-note {
  list-style: none; margin: 16px 0 0; padding: 0;
  color: var(--muted); font-size: 12.5px; line-height: 1.95;
}
.auth-note li { padding-left: 16px; position: relative; }
.auth-note li::before {
  content: "·"; position: absolute; left: 4px;
  color: var(--primary); font-weight: 700;
}

.tag {
  display: inline-block; padding: 1px 8px; border-radius: 20px;
  background: var(--primary-soft); color: var(--primary);
  font-size: 12px; font-weight: 600;
}

/* ---------------- 账号 / 审批 ---------------- */
.badge {
  display: inline-block; min-width: 17px; height: 17px; line-height: 17px;
  padding: 0 5px; margin-left: 4px; border-radius: 9px;
  background: var(--danger); color: #fff;
  font-size: 11px; font-weight: 700; text-align: center;
}
.mini-role {
  font-size: 10.5px; font-weight: 500; color: var(--primary);
  background: var(--primary-soft); border-radius: 4px; padding: 0 4px;
}
.tag-admin { background: #eef0fd; color: #4a4fb0; }
.tag-pending { background: var(--warn-soft); color: var(--warn); }
.tag-ok { background: var(--success-soft); color: var(--success); }
.tag-off { background: #f1f2f5; color: #8b93a1; }
.tag-me { background: #f1f2f5; color: #6b7280; margin-left: 4px; }
.row-me { background: #fbfcff; }
.muted-sm { color: var(--muted); font-size: 12px; }

.pending-list { display: flex; flex-direction: column; gap: 10px; }
.pending-item {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  border: 1px solid #f0dcbc; background: #fffdf8;
  border-radius: 8px; padding: 12px 14px;
}
.pending-main { min-width: 0; }
.pending-name { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.pending-name b { font-size: 14px; }
.pending-meta {
  display: flex; flex-wrap: wrap; gap: 4px 18px;
  color: var(--muted); font-size: 12.5px;
}
.pending-ops { display: flex; gap: 8px; flex-shrink: 0; }
.auth-wide { max-width: 720px; }
.tips-card { margin-top: 18px; }
.section-title { margin: 24px 0 10px; font-size: 15px; font-weight: 700; color: #3d4658; }

@media (max-width: 1080px) {
  .grid-2-wide { grid-template-columns: 1fr; }
  .data-table th:nth-child(7), .data-table td:nth-child(7) { display: none; }
}
@media (max-width: 820px) {
  .grid-2 { grid-template-columns: 1fr; }
  .nav { display: none; }
  .main { padding: 18px 14px 40px; }
  .wrap { padding: 0 14px; }
  .data-table th:nth-child(5), .data-table td:nth-child(5),
  .data-table th:nth-child(8), .data-table td:nth-child(8) { display: none; }
}

/* ---- 按日期导出：日期条 ---- */
.datebar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 0 0 14px; padding: 10px 14px;
  background: #f7f9fd; border: 1px solid var(--line); border-radius: 10px;
}
.datebar-title { font-size: 13px; font-weight: 600; color: #3d4658; }
.datebar-f { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
.datebar-f input {
  height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px;
  background: #fff; font-family: inherit; font-size: 12.5px; color: var(--text); outline: none;
}
.datebar-f input:focus { border-color: #9db4dd; box-shadow: 0 0 0 3px rgba(47, 85, 151, .1); }
.datebar-hint { font-size: 12px; color: var(--muted); }

/* ---- 每页条数下拉 ---- */
.datebar-f select {
  height: 32px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px;
  background: #fff; font-family: inherit; font-size: 12.5px; color: var(--text); outline: none;
}
.datebar-f select:focus { border-color: #9db4dd; box-shadow: 0 0 0 3px rgba(47, 85, 151, .1); }

/* ---- 招聘状态筛选 ---- */
.datebar-c {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12.5px; color: #3d4658; cursor: pointer; user-select: none;
}
.datebar-c input { width: 15px; height: 15px; accent-color: var(--brand); cursor: pointer; }
.filter-note {
  margin: -6px 0 14px; padding: 8px 14px;
  font-size: 12.5px; color: #6b7280;
  background: #fbfcfe; border: 1px dashed var(--line); border-radius: 9px;
}
.filter-note b { color: #b26a00; font-weight: 700; }
.filter-note a { color: var(--brand); text-decoration: none; }
.filter-note a:hover { text-decoration: underline; }

/* ---- 微信发布 ---- */
.wx-theme-card { margin-bottom: 14px; padding: 14px 16px; }
.wx-theme-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.wx-theme-title { font-size: 13.5px; font-weight: 600; color: #3d4658; }
.wx-theme-sub { font-size: 12px; color: var(--muted); }
.wx-themes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wx-theme {
  display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px 0 10px;
  border: 1px solid var(--line); border-radius: 999px; background: #fff; color: #3d4658;
  font-family: inherit; font-size: 13px; cursor: pointer;
  transition: border-color .15s, background .15s, color .15s, box-shadow .15s;
}
.wx-theme:hover { border-color: #c9d2e3; background: #fbfcfe; }
.wx-theme.on {
  border-color: var(--c, #2f5597); background: var(--bg, #eef3fc);
  color: var(--c, #2f5597); font-weight: 600;
  box-shadow: 0 0 0 3px rgba(47, 85, 151, .08);
}
.wx-dot {
  width: 14px; height: 14px; border-radius: 50%; flex: none;
  background: var(--c, #2f5597); box-shadow: 0 0 0 2px var(--bg, #eef3fc);
}
.wx-color {
  width: 20px; height: 20px; padding: 0; border: 1px solid var(--line); border-radius: 50%;
  background: none; cursor: pointer; flex: none;
}
.wx-color::-webkit-color-swatch-wrapper { padding: 0; }
.wx-color::-webkit-color-swatch { border: none; border-radius: 50%; }
.wx-color::-moz-color-swatch { border: none; border-radius: 50%; }
.wx-tools {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 0 0 14px; padding: 10px 14px;
  background: #f7f9fd; border: 1px solid var(--line); border-radius: 10px;
}
.wx-tip { font-size: 12.5px; color: var(--muted); }
.wx-tip.ok { color: #1f7a45; }
.wx-tip.err { color: #b3341f; }
.wx-card { margin-bottom: 16px; }
.wx-preview {
  max-width: 430px; margin: 0 auto; padding: 18px 16px;
  background: #fff; border: 1px solid #eceff4; border-radius: 10px;
}
.wx-code-card { margin-bottom: 24px; }
.wx-code-card summary { cursor: pointer; font-weight: 600; font-size: 14px; color: #3d4658; }
.wx-code {
  width: 100%; height: 300px; margin-top: 12px; padding: 12px;
  border: 1px solid var(--line); border-radius: 8px; background: #fafbfc;
  font-family: ui-monospace, Consolas, "Courier New", monospace;
  font-size: 12px; line-height: 1.6; color: #3d4658; resize: vertical;
}

/* ---- 勾选导出：选择条 + 行内复选框 ---- */
.selbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 0 0 14px; padding: 10px 14px;
  background: #eef3ff; border: 1px solid #d3e0fb; border-radius: 10px;
}
.selbar-count { font-size: 13px; color: #3d4658; }
.selbar-count b { color: #2f5597; font-size: 15px; margin: 0 2px; }
.selbar-hint { font-size: 12.5px; color: var(--muted); }
.selbar .btn[disabled] { opacity: .55; cursor: not-allowed; box-shadow: none; }
.pick-box {
  width: 15px; height: 15px; margin: 0 6px 0 0;
  vertical-align: -2px; accent-color: #2f5597; cursor: pointer;
}
th .pick-box { margin-right: 4px; }
`;
