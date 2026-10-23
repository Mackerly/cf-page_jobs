# 招聘信息管理系统 · Cloudflare Pages 版

用 **Cloudflare Pages + Pages Functions + D1** 实现的招聘信息管理系统。代码放在 GitHub 上，
在 Cloudflare 控制台把 Pages 项目连到仓库，之后**每次 push 自动部署**，开 PR 还会自动生成预览地址。

功能与 Flask 版、Worker 版完全一致：

- 招聘信息增删改查、搜索分页（列表公开浏览）
- 每条招聘信息生成 **单页 A4 Word 简章**（含底部二维码 + 「扫码关注，获取最新招聘信息」）
- 批量生成 Word（ZIP）、**勾选多条导出到同一个 Word（每条一页）**、导入 Excel/CSV、导出 Excel、下载导入模板
- 登录、注册申请 + 管理员审批、角色/状态管理、审计日志、强制改密、CSRF、限流
- 首次部署用 `/setup?token=…` 创建第一个管理员

---

## 一、为什么是 Pages 而不是 Workers

| | Workers | Pages |
| --- | --- | --- |
| 接 GitHub 自动部署 | 需要自己写 GitHub Actions | **控制台点几下就连上**，push 即部署 |
| PR / 分支预览 | 需额外配置 | **自动生成预览域名** |
| 静态资源 | 需 `[assets]` 配置 | `public/` 目录直接托管，带 CDN |
| 适合场景 | 纯 API / 定时任务 | **带前端资源的全栈站点（本项目）** |

本项目所有页面都是服务端渲染（CSS 内联），静态文件只有 favicon 和 robots.txt，
但 Pages 的 Git 集成体验明显更省事，所以这版按 Pages 的形态组织：

- `functions/[[path]].ts` —— 一个 catch-all 函数接管全部动态路由
- `public/` —— 静态资源目录（**不要放 index.html**，否则首页会被静态文件抢走）
- `src/` —— 业务代码，与 Worker 版共用同一套模块

---

## 二、目录结构

```
cf-pages/
├── functions/
│   └── [[path]].ts        # Pages Functions 入口：把 request/env 交给 handleRequest()
├── src/
│   ├── app.ts             # 路由分发、鉴权、CSRF、错误页、/setup
│   ├── auth.ts            # PBKDF2 密码、HMAC 签名会话、CSRF、Flash、限流
│   ├── db.ts              # D1 数据访问
│   ├── html.ts / css.ts   # 页面模板与样式
│   ├── docx.ts / format.ts# 单页 Word 生成 + 排版估算
│   ├── xlsx.ts / xlsx-import.ts  # Excel 导出/模板/导入解析
│   └── qr.ts              # 二维码 JPEG（base64 内联）
├── public/
│   ├── favicon.svg
│   ├── robots.txt
│   ├── _headers           # 静态资源的响应头
│   └── _routes.json       # 把静态资源排除出函数路由（关键！）
├── schema.sql             # 建表脚本
├── seed.sql               # 演示数据（admin/admin123 + 3 条示例）
├── scripts/
│   └── reset-local-db.mjs # 本地库建表+灌数据（不依赖 wrangler 的 D1 声明）
├── wrangler.toml          # 本地开发 + 环境变量（D1 绑定在控制台配）
├── package.json
└── tests/e2e.py           # 70 项端到端断言
```

---

## 三、从 GitHub 部署（推荐流程）

### 第 1 步：创建 D1 数据库

```bash
cd cf-pages
npm install
npx wrangler login
npx wrangler d1 create recruit
```

输出里会有：

```
[[d1_databases]]
binding = "DB"
database_name = "recruit"
database_id = "1234abcd-12ab-34cd-56ef-1234567890ab"
```

把这个 `database_id` 记下来，两种绑定方式**二选一**：

| 方式 | 做法 | 说明 |
| --- | --- | --- |
| A. 控制台绑定（当前仓库采用） | Pages 项目 → **Settings → Bindings → Add → D1 database**，Variable name 填 `DB`，选 `recruit` | `wrangler.toml` 里的 `[[d1_databases]]` 保持注释状态 |
| B. 写进 `wrangler.toml` | 取消注释 `[[d1_databases]]`，把 `REPLACE_WITH_YOUR_DATABASE_ID` 换成真实 id | 构建时自动带上绑定，但 id 会进仓库 |

> ⚠️ **这一步不做，线上每个查库的页面都会 500**（报 `no such table: recruit` 或
> `D1_ERROR`）。判断方法：`/health`、`/login` 正常但 `/` 500，就是没绑 D1。
> 另外 `REPLACE_WITH_YOUR_DATABASE_ID` 是占位符，**直接提交会构建失败**，所以本仓库默认走方式 A。

### 第 2 步：建表

```bash
npx wrangler d1 execute recruit --remote --file=./schema.sql
```

### 第 3 步：把代码推到 GitHub

本目录已经是一个独立的 git 仓库，远端就是 <https://github.com/Mackerly/cf-page_jobs>，
分支 `main`，日常改动只需：

```bash
git add -A
git commit -m "说明这次改了什么"
git push
```

换一台机器或换仓库时，完整流程是：

```bash
git init
git add .
git commit -m "招聘信息管理系统：Cloudflare Pages + D1"
git branch -M main
git remote add origin https://github.com/Mackerly/cf-page_jobs.git
git push -u origin main
```

> 仓库根**就是**本目录（`cf-pages/` 的内容直接铺在根上），所以第 4 步的 Root directory 留空。
> 如果你把整个项目（含 Flask 版、cf-worker）推到同一个仓库，仓库根就是上一层，
> 那时 **Root directory 要填 `cf-pages`**。

`.gitignore` 已经排除了 `node_modules/`、`.wrangler/`、`.dev.vars`，不会把密钥推上去。

### 第 4 步：在 Cloudflare 控制台连接仓库

1. 打开 <https://dash.cloudflare.com> → 左侧 **Workers & Pages** → **Create**
2. 选 **Pages** 标签 → **Connect to Git**
3. 授权 GitHub，选中刚才的仓库 → **Begin setup**
4. 填写构建设置：

   | 项目 | 值 |
   | --- | --- |
   | Project name | `recruit-pages`（决定默认域名 `xxx.pages.dev`） |
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `npm install` |
   | Build output directory | `public` |
   | Root directory（可选） | **留空**（本仓库根就是项目根）；若仓库还放了别的东西则填 `cf-pages` |

5. 展开 **Environment variables (advanced)**，添加：

   | 变量名 | 值 | 类型 |
   | --- | --- | --- |
   | `SESSION_SECRET` | 32 位以上随机串（如 `openssl rand -hex 32` 的输出） | **Secret** |
   | `SETUP_TOKEN` | 自己定一个初始化口令，如 `init-2026-recruit` | **Secret** |
   | `SITE_NAME` | 站点名称，如 `招聘信息管理系统-到人社炎陵站`（改这里就不用改代码） | Plaintext |
   | `ALLOW_REGISTER` | `true`（关闭注册改成 `false`） | Plaintext |
   | `PBKDF2_ITERATIONS` | `100000` | Plaintext |

   > Production 和 Preview 是两套环境变量，**两个都要加**，否则预览部署会报缺少 SESSION_SECRET。

6. 点 **Save and Deploy**，等 1～2 分钟构建完成。

### 第 5 步：创建第一个管理员

浏览器打开：

```
https://<你的项目名>.pages.dev/setup?token=<你填的 SETUP_TOKEN>
```

填账号密码提交 → 自动跳到登录页。之后这个地址会永久返回 404（已初始化）。
建好后建议把初始化口令删掉：控制台 → Settings → Variables and Secrets → 删除 `SETUP_TOKEN` → 重新部署。

登录后即可使用：新增 / 导入 Excel / 导出 Excel / 批量生成 Word / 用户管理 / 操作日志。

### 之后的自动部署

| 操作 | 结果 |
| --- | --- |
| push 到 `main` | 自动构建并发布到生产域名 |
| push 到其他分支 / 开 PR | 自动生成一个预览 URL（形如 `abc123.recruit-pages.pages.dev`） |
| 在控制台点 Retry deployment | 用同一份代码重新构建 |

---

## 四、本地开发

```bash
cd cf-pages
npm install
cp .dev.vars.example .dev.vars        # Windows: copy .dev.vars.example .dev.vars

npm run dev                            # http://127.0.0.1:8788
npm run db:reset:local                 # 另开一个终端：建表 + 演示数据
```

`npm run dev` 已带 `--d1=DB=recruit`，会在 `.wrangler/state` 下自动建一个空的本地库；
`db:reset:local` 再往这个库里灌 `schema.sql` + `seed.sql`（用的是 Node 内置 sqlite，
不依赖 wrangler 的 D1 声明）。**顺序不能反**：先起一次 `npm run dev` 生成本地库文件。

> 之所以不用 `wrangler d1 execute`：`wrangler.toml` 里的 `[[d1_databases]]` 已被注释掉
> （D1 绑定改在 Pages 控制台配置），此时 `wrangler d1 execute` 会报
> `Couldn't find a D1 DB with the name or binding 'recruit'`。
> 如果你把那段绑定恢复并填上真实 `database_id`，`npm run db:init:local` / `db:seed:local` 也能用。

本地账号：`admin / admin123`。若本地库是空的，用
`http://127.0.0.1:8788/setup?token=dev-setup-token` 创建管理员。

站名由 `wrangler.toml` 的 `SITE_NAME`（线上则是环境变量）控制，会替换页面标题、页头品牌和页脚。

> 本地 D1 与 `wrangler d1 execute --local` 共用 `.wrangler/state`，
> 所以 `db:init:local` 建的表 `npm run dev` 能直接读到。改完 `wrangler.toml` 的绑定后要重启 dev。

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地启动 Pages（含 Functions），端口 8788 |
| `npm run db:init` | 线上执行 `schema.sql` |
| `npm run db:init:local` | 本地执行 `schema.sql` |
| `npm run db:seed:local` | 本地写入演示数据 |
| `npm run deploy` | 不用 Git 集成时，直接 `wrangler pages deploy` |
| `npm run typecheck` | `tsc --noEmit` |

跑端到端测试（需先 `npm run dev`，且数据是种子状态）：

```bash
python tests/e2e.py        # 期望：通过 60 项，失败 0 项
```

---

## 五、Pages 特有的三个坑（已在本项目里处理好）

### 1. catch-all 函数会把静态文件也吃掉

用 `functions/[[path]].ts` 接管全站时，`/favicon.svg`、`/robots.txt` 这类请求也会进函数。
解决办法是 `public/_routes.json` 显式排除：

```json
{ "version": 1, "include": ["/*"], "exclude": ["/favicon.svg", "/robots.txt"] }
```

不加这个文件，静态资源会全部 404（实测过）。规则上限 100 条，静态文件多的话可以按前缀排除。

### 2. 不要在 `public/` 放 `index.html`

Pages 会优先返回静态文件，`public/index.html` 会让首页变成静态页，覆盖掉 `/` 的动态路由。
本项目的 `public/` 只放 favicon、robots.txt 和两个配置文件。

### 3. 预览部署默认连的是生产 D1

同一个 D1 绑定对 Production 和 Preview 都生效，**PR 预览环境会直接读写生产数据**。
如果不想这样，去 D1 再建一个 `recruit-preview` 库，在 Preview 环境的绑定里指向它。

---

## 六、与 Worker 版的差异（代码层面）

| 项目 | Worker 版 | Pages 版 |
| --- | --- | --- |
| 入口 | `export default { fetch(req, env, ctx) }` | `functions/[[path]].ts` 的 `export const onRequest` |
| 业务入口 | `fetch()` 方法 | `src/app.ts` 的 `handleRequest(req, env)` |
| 静态资源 | 代码里返回 | `public/` 目录托管 |
| 绑定配置 | `wrangler.toml` + `wrangler secret` | 控制台变量 + `wrangler.toml`/控制台绑定 |
| 本地端口 | 8787 | 8788 |
| 其余业务代码 | —— | **完全相同**（同一套 `src/*.ts`） |

因为业务逻辑一字未改，Worker 版验证过的排版算法、Excel 解析、鉴权行为在 Pages 版同样成立。

---

## 七、路由一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/` | 公开 | 列表 + 搜索 + 分页 |
| GET | `/preview/:id` | 公开 | 网页打印预览 |
| GET | `/docx/:id` | 公开 | 下载单页 Word |
| GET | `/qr.jpg` | 公开 | 二维码原图 |
| GET | `/health` | 公开 | 健康检查 |
| GET/POST | `/login` `/register` | 公开 | 登录 / 注册申请 |
| GET/POST | `/setup` | 口令 | 首次初始化管理员 |
| POST | `/logout` | 登录 | 退出 |
| GET/POST | `/password` | 登录 | 修改密码 |
| GET/POST | `/add` `/edit/:id` | 登录 | 新增 / 修改 |
| POST | `/delete/:id` | 登录 | 删除 |
| GET/POST | `/import` | 登录 | 导入 Excel / CSV |
| GET | `/export/excel` `/template.xlsx` `/docx/zip` | 登录 | 导出 Excel / 模板 / 批量 Word |
| POST | `/docx/selected` | 登录 | 勾选的多条合并为一个 Word（每条一页） |
| GET | `/users` | 管理员 | 账号管理 |
| POST | `/users/:id/action` | 管理员 | 审批/停用/启用/改角色/重置密码/删除 |
| GET | `/audit` | 管理员 | 审计日志 |

---

## 八、安全设计

| 项目 | 做法 |
| --- | --- |
| 密码 | PBKDF2-HMAC-SHA256 + 16 字节随机盐，迭代次数随记录存库 |
| 会话 | HMAC-SHA256 签名的 HttpOnly Cookie，8 小时过期，停用/改密后立即失效 |
| CSRF | 双提交 Cookie + 所有 POST 校验 `_csrf`，常数时间比较 |
| XSS | 输出统一经 `h()` 转义 |
| 响应头 | `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy` |
| 越权 | 受保护路由先校验会话状态，管理员路由再校验角色 |
| 暴力破解 | 同 IP + 账号 15 分钟 5 次失败锁定 |
| 审计 | 登录、注册、审批、增删改、导入导出、批量生成全部留痕 |

---

## 九、常见问题

**构建报 `Couldn't find a D1 DB with the name or binding 'recruit'`**
`wrangler.toml` 里的 `database_id` 还是占位符，或者 `[[d1_databases]]` 被删了但没在控制台绑定。

**页面能打开但一访问就 500，日志里是 `no such table: recruit`**
建表脚本没在**线上**库执行。跑 `npx wrangler d1 execute recruit --remote --file=./schema.sql`。

**提示缺少 SESSION_SECRET**
控制台 Settings → Variables and Secrets 里没加，或者只加到了 Production、预览环境没加。

**登录报 `Exceeded CPU Time Limit`**
免费版 Pages Functions CPU 限额较紧，把 `PBKDF2_ITERATIONS` 从 100000 降到 50000，重新部署。

**favicon / robots.txt 404**
`public/_routes.json` 被删了，或者新增的静态文件没加进 `exclude`。

**想回滚**
控制台 → Deployments → 找到历史版本 → **Rollback to this deployment**。

**导出数据库备份**

```bash
npx wrangler d1 export recruit --remote --output=backup-$(date +%F).sql
```
