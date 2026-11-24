-- 011_eval_entity_status: user-set status + memo on equipment and Lots of the evaluation board (V-005).
-- Status is a label (wait/active/hold/done). Wait time is still derived from eval_stage_log only (D-09).
ALTER TABLE eval_equipment ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('wait', 'active', 'hold', 'done'));
ALTER TABLE eval_equipment ADD COLUMN note TEXT;
ALTER TABLE eval_lots ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('wait', 'active', 'hold', 'done'));
ALTER TABLE eval_lots ADD COLUMN note TEXT;
