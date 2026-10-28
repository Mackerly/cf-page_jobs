-- 迁移 001：给已有库补「发布日期」publish_date
-- 新库直接用 schema.sql 建表即可，无需执行本文件。
-- 执行：npx wrangler d1 execute recruit --remote --file=./migrations/001_publish_date.sql
-- 注意：列已存在时会报 duplicate column name，可忽略。

ALTER TABLE recruit ADD COLUMN publish_date TEXT DEFAULT '';

-- 老数据按录入日期回填，避免筛不到
UPDATE recruit SET publish_date = substr(created_at, 1, 10)
  WHERE (publish_date IS NULL OR publish_date = '') AND length(COALESCE(created_at, '')) >= 10;
UPDATE recruit SET publish_date = date('now', 'localtime')
  WHERE publish_date IS NULL OR publish_date = '';

CREATE INDEX IF NOT EXISTS idx_recruit_publish ON recruit(publish_date);
