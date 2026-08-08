BEGIN;

-- ============================================================
-- GATE-2.5 H2: reminder correctness — occurrence lifecycle
-- (additive migration, never destructive)
-- ============================================================
-- New model:
--   recurrence : repeat_rule (none|daily|weekly) + repeat_time ("HH:MM"
--                LOCAL wall clock in the reminder's tz) + tz (IANA name;
--                NULL = system local zone) + repeat_anchor_date (local
--                calendar date of the first occurrence — weekly anchor).
--   occurrence : due_at (UTC instant, always "+00:00" ISO-8601) +
--                occ_status (active|fired|snoozed|dismissed) +
--                snoozed_until (UTC instant at which a snoozed occurrence
--                reactivates).
-- The legacy `status` column keeps SCHEDULE liveness only:
-- active (live), cancelled (user cancelled), fired (one-shot exhausted).
-- Old columns are kept for backwards compatibility; cleanup is documented
-- in the H2 report.

ALTER TABLE reminders ADD COLUMN repeat_time TEXT;
ALTER TABLE reminders ADD COLUMN tz TEXT;
ALTER TABLE reminders ADD COLUMN repeat_anchor_date TEXT;
ALTER TABLE reminders ADD COLUMN occ_status TEXT NOT NULL DEFAULT 'active'
  CHECK (occ_status IN ('active','fired','snoozed','dismissed'));
ALTER TABLE reminders ADD COLUMN snoozed_until TEXT;

-- Backfill: legacy naive due_at values were compared as wall-clock-UTC by
-- the old scheduler; attach +00:00 so every stored instant is a uniform,
-- epoch-normalized UTC string and TEXT ordering == instant ordering.
UPDATE reminders
   SET due_at = due_at || '+00:00'
 WHERE due_at NOT LIKE '%Z'
   AND due_at NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]';
UPDATE reminders SET due_at = replace(due_at, 'Z', '+00:00') WHERE due_at LIKE '%Z';

CREATE INDEX IF NOT EXISTS idx_reminders_occ_due
  ON reminders(status, occ_status, due_at);

COMMIT;
