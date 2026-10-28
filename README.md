# 招聘信息管理系统 · Cloudflare Pages 版

用 **Cloudflare Pages + Pages Functions + D1** 实现的招聘信息管理系统。代码放在 GitHub 上，
在 Cloudflare 控制台把 Pages 项目连到仓库，之后**每次 push 自动部署**，开 PR 还会自动生成预览地址。

功能与 Flask 版、Worker 版完全一致：

- 招聘信息增删改查、搜索分页（列表公开浏览），**每页条数可选 15 / 30 / 50 / 100**，可按起止日期筛选
- 每条招聘信息生成 **单页 A4 Word 简章**（含底部二维码 + 「扫码关注，获取最新招聘信息」）
- 批量生成 Word（ZIP）、**勾选多条导出到同一个 Word（每条一页）**、**按起止日期导出 Word（每条一页）**、
  导入 Excel/CSV、导出 Excel（默认全部，也可按起止日期筛选）、下载导入模板
- **微信发布 HTML**：勾选若干条生成公众号排版（复制富文本直接粘贴 / 复制源码 / 下载 .html）
- **数据库备份**：管理员一键下载整库 `.sql`（表结构 + 索引 + 数据）
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
├── wrangler.toml          # 仅本地开发用；变量/机密/D1 绑定全部在控制台配（见第三节）
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

把这个 `database_id` 记下来，**绑定统一在控制台做**：

> Pages 项目 → **Settings → Bindings → Add → D1 database**，Variable name 填 `DB`，选 `recruit`。
> Production 和 Preview 两个环境各绑一次（预览部署默认连同一个库，见第五节第 3 条）。

> ⚠️ **这一步不做，线上每个查库的页面都会 500**（报 `no such table: recruit` 或
> `D1_ERROR`）。判断方法：`/health`、`/login` 正常但 `/` 500，就是没绑 D1。
>
> 也可以把 `[[d1_databases]]` 写进 `wrangler.toml`（填真实 `database_id`），但**不推荐**：
> 一旦 wrangler.toml 参与线上配置，控制台的绑定和变量就变成「只能看、不能改」，
> 以后加变量、换库都得改代码重新推。本仓库已经把这类配置从文件里全部拿掉了。

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

5. 展开 **Environment variables (advanced)**，添加下面 5 个（也可以在部署完成后再加，
   见本节末尾的「配置项一览」）：

   | 变量名 | 值 | 类型 |
   | --- | --- | --- |
   | `SESSION_SECRET` | 32 位以上随机串（如 `openssl rand -hex 32` 的输出） | **Secret** |
   | `SETUP_TOKEN` | 自己定一个初始化口令，如 `init-2026-recruit` | **Secret** |
   | `SITE_NAME` | 站点名称，如 `招聘信息管理系统-洲到人社炎陵站`（改这里就不用改代码） | Plaintext |
   | `ALLOW_REGISTER` | `true`（关闭注册改成 `false`） | Plaintext |
   | `PBKDF2_ITERATIONS` | `100000` | Plaintext |

   > Production 和 Preview 是两套环境变量，**两个都要加**，否则预览部署会报缺少 SESSION_SECRET。

6. 点 **Save and Deploy**，等 1～2 分钟构建完成。

#### 配置项一览（全部在控制台，代码仓库里不存任何密钥）

所有配置都走 **Settings → Variables and Secrets**，`wrangler.toml` 里**不写** `[vars]`、
也不写 D1 绑定——只要文件里出现这些配置，控制台对应字段就会变成只读，加不了新变量。
改完变量点一下 **Redeploy** 才生效（环境变量是构建时注入的）。

| 位置 | 配置 | 说明 |
| --- | --- | --- |
| Variables and Secrets | `SESSION_SECRET` / `SETUP_TOKEN` | 机密，建议用 Secret 类型（加密存储、页面不再显示明文） |
| Variables and Secrets | `SITE_NAME` / `ALLOW_REGISTER` / `PBKDF2_ITERATIONS` | 普通变量，改了不用改代码 |
| Bindings | `DB` → D1 `recruit` | 数据库绑定 |
| Build → Build output directory | `public` | 构建设置，在控制台填，别写进 wrangler.toml |

> 变量都有兜底默认值，漏配不会白屏：`SITE_NAME` 缺省为「招聘信息管理系统」，
> `ALLOW_REGISTER` 缺省 `true`，`PBKDF2_ITERATIONS` 缺省 `100000`；
> 只有 `SESSION_SECRET` 是硬性要求，缺了会直接提示怎么加。

### 第 5 步：创建第一个管理员

浏览器打开：

```
https://<你的项目名>.pages.dev/setup?token=<你填的 SETUP_TOKEN>
```

填账号密码提交 → 自动跳到登录页。之后这个地址会永久返回 404（已初始化）。
建好后建议把初始化口令删掉：控制台 → Settings → Variables and Secrets → 删除 `SETUP_TOKEN` → 重新部署。

登录后即可使用：新增 / 导入 Excel / 导出 Excel / 批量生成 Word / 按日期导出 Word / 用户管理 / 操作日志。

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

`npm run dev` 实际执行的是 `wrangler pages dev public --d1=DB=recruit --port 8788`：
`public` 是静态目录，`--d1` 现场造一个名为 `recruit` 的本地 D1（`wrangler.toml` 里没有绑定声明），
环境变量则来自 `.dev.vars`（`SITE_NAME`、`ALLOW_REGISTER`、`PBKDF2_ITERATIONS`、
`SESSION_SECRET`、`SETUP_TOKEN` 五个都在里面）。
`db:reset:local` 再往这个库里灌 `schema.sql` + `seed.sql`（用的是 Node 内置 sqlite，
不依赖 wrangler 的 D1 声明）。**顺序不能反**：先起一次 `npm run dev` 生成本地库文件。

> 之所以不用 `wrangler d1 execute`：`wrangler.toml` 里没有 `[[d1_databases]]`
> （D1 绑定在 Pages 控制台配置），此时 `wrangler d1 execute` 会报
> `Couldn't find a D1 DB with the name or binding 'recruit'`。
> 如果你临时把绑定写回 wrangler.toml 并填上真实 `database_id`，`npm run db:init:local` / `db:seed:local` 也能用，
> 但记得用完删掉，否则控制台又会变只读。

本地账号：`admin / admin123`。若本地库是空的，用
`http://127.0.0.1:8788/setup?token=dev-setup-token` 创建管理员。

站名在 `.dev.vars` 的 `SITE_NAME` 里改（线上则在控制台变量里改），会替换页面标题、页头品牌和页脚。

> 本地 D1 与 `wrangler d1 execute --local` 共用 `.wrangler/state`，
> 所以 `db:init:local` 建的表 `npm run dev` 能直接读到。

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
| 绑定配置 | `wrangler.toml` + `wrangler secret` | **全部在控制台**（Variables and Secrets / Bindings），文件里不存配置 |
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
| GET | `/export/excel` `/template.xlsx` `/docx/zip` | 登录 | 导出 Excel（可带 `start` / `end`）/ 模板 / 批量 Word |
| GET | `/docx/range?start=&end=` | 登录 | 按起止日期导出，范围内每条一页合并成一个 Word |
| POST | `/docx/selected` | 登录 | 勾选的多条合并为一个 Word（每条一页） |
| POST | `/wechat/selected` | 登录 | 勾选的多条生成公众号可粘贴的 HTML（单篇最多 30 条） |
| GET | `/backup.sql` | 管理员 | 整库 SQL 备份（表结构 + 索引 + 数据） |
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

**控制台 Settings → Variables and Secrets 是灰的，加不了变量 / 看不到「Add」按钮**
说明 `wrangler.toml` 参与了线上配置。Pages 的规则是：只要配置文件里出现 `pages_build_output_dir`、
`[vars]` 或绑定，这个文件就成了「配置源」，控制台只能看不能改。
本仓库已经把这些都从 `wrangler.toml` 删掉了，只留 `name` 和 `compatibility_date`。
如果你自己又加回去了，删掉后重新部署一次，控制台就恢复可编辑；
实在不放心可以直接删掉整个 `wrangler.toml`（上一次部署的配置会保留，仍可在控制台改）。

> 删掉 `pages_build_output_dir` 后，**构建设置 → Build output directory 会变成可编辑**，
> 值沿用上一次部署的 `public`，一般不用动；万一为空，手动填 `public` 再部署。

**改了变量但页面没变**
环境变量是构建时注入的，改完要点 **Redeploy**（或重新 push 一次）才生效；
另外注意 Production 和 Preview 是两套变量，预览地址用的是 Preview 那套。

**构建报 `Couldn't find a D1 DB with the name or binding 'recruit'`**
没有在控制台绑 D1。去 Settings → Bindings 加一条 D1 database，变量名 `DB`，选 `recruit`。

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
