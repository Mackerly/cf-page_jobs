-- 招聘信息管理系统 · Cloudflare D1 表结构
-- 执行：wrangler d1 execute recruit --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS recruit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    position     TEXT NOT NULL,
    headcount    TEXT DEFAULT '',
    requirements TEXT DEFAULT '',
    salary       TEXT DEFAULT '',
    address      TEXT DEFAULT '',
    phone        TEXT DEFAULT '',
    publish_date TEXT DEFAULT '',          -- 发布日期 YYYY-MM-DD（表单默认当天，筛选也用它）
    status       TEXT DEFAULT 'active',    -- 招聘状态 active 招聘中 | full 已招满 | expired 已失效
                                           -- 「发布满 1 个月自动失效」是展示时算的，不写库
    owner_id     INTEGER DEFAULT 0,        -- 发布人 users.id；乡镇职达站 / 企业只能改自己发布的
    created_at   TEXT DEFAULT '',
    updated_at   TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    pwd_hash    TEXT NOT NULL,
    salt        TEXT NOT NULL,
    iterations  INTEGER NOT NULL DEFAULT 100000,
    must_change INTEGER NOT NULL DEFAULT 0,
    last_login  TEXT DEFAULT '',
    created_at  TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active',   -- pending | active | disabled
    role        TEXT NOT NULL DEFAULT 'enterprise',
                                               -- super 超级管理员 | admin 管理员
                                               -- town 乡镇职达站 | enterprise 企业
                                               -- 乡镇职达站 / 企业可查看全部，只能改自己发布的
    real_name   TEXT DEFAULT '',
    phone       TEXT DEFAULT '',
    remark      TEXT DEFAULT '',
    approved_at TEXT DEFAULT '',
    approved_by TEXT DEFAULT '',
    reg_ip      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT DEFAULT '',
    username TEXT DEFAULT '',
    action   TEXT DEFAULT '',
    detail   TEXT DEFAULT '',
    ip       TEXT DEFAULT ''
);

-- 系统设置（键值对）：header_text = 导出简章的页眉文字
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);

-- 登录失败记录（用于限流，D1 里没有共享内存）
CREATE TABLE IF NOT EXISTS login_fail (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ip       TEXT DEFAULT '',
    username TEXT DEFAULT '',
    ts       INTEGER NOT NULL DEFAULT 0          -- Unix 秒
);

CREATE INDEX IF NOT EXISTS idx_recruit_created ON recruit(id DESC);
CREATE INDEX IF NOT EXISTS idx_recruit_publish ON recruit(publish_date);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(id DESC);
CREATE INDEX IF NOT EXISTS idx_login_fail ON login_fail(ip, username, ts);
