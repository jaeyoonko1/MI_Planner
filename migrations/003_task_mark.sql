-- 003_task_mark: star / urgent mark of a journal task line (P2B-05).
-- NULL = plain, 'star' = important, 'urgent' = blocked/urgent. Done-ness stays in tasks.status.
ALTER TABLE tasks ADD COLUMN mark TEXT CHECK (mark IN ('star', 'urgent'));
