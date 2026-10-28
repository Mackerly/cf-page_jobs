-- 迁移 002：给已有库补「招聘状态」status
-- 新库直接用 schema.sql 建表即可，无需执行本文件。
-- 执行：npx wrangler d1 execute recruit --remote --file=./migrations/002_status.sql
--      或 npm run db:migrate:status
-- 注意：列已存在时会报 duplicate column name，可忽略。

ALTER TABLE recruit ADD COLUMN status TEXT DEFAULT 'active';

-- 老数据统一按「招聘中」处理；
-- 「发布满 1 个月自动失效」由程序在展示时按 publish_date 计算，不需要回写本列。
UPDATE recruit SET status = 'active' WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_recruit_status ON recruit(status);
