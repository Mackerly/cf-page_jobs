-- 迁移 003：账号类型（四种角色）+ 招聘信息发布人 + 系统设置表
-- 新库直接用 schema.sql 建表即可，无需执行本文件。
-- 执行：npx wrangler d1 execute recruit --remote --file=./migrations/003_owner_role.sql
--      或 npm run db:migrate:roles
-- 注意：列已存在时会报 duplicate column name，可忽略。

-- 1) 招聘信息记录发布人：乡镇职达站 / 企业只能改自己发布的
ALTER TABLE recruit ADD COLUMN owner_id INTEGER DEFAULT 0;
UPDATE recruit SET owner_id = 0 WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_recruit_owner ON recruit(owner_id);

-- 2) 系统设置（键值对），header_text = 导出简章的页眉文字
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);

-- 3) 旧角色迁移：
--    user  -> enterprise（看全部、只改自己的）
--    admin -> 保持 admin（管理员）
UPDATE users SET role = 'enterprise' WHERE role = 'user' OR role IS NULL OR role = '';
UPDATE users SET role = 'enterprise'
 WHERE role NOT IN ('super', 'admin', 'town', 'enterprise');

-- 4) 保证至少有一个超级管理员：没有就把最早建的账号升上去
UPDATE users SET role = 'super'
 WHERE id = (SELECT MIN(id) FROM users)
   AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'super');

-- 5) 页眉默认值不写库（程序里 DEFAULT_HEADER 兜底），这里只在缺失时留空
INSERT INTO settings (key, value) VALUES ('header_text', '')
  ON CONFLICT(key) DO NOTHING;
