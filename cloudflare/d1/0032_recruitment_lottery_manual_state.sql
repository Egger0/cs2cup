ALTER TABLE recruitment_lottery_campaign
ADD COLUMN manual_state TEXT CHECK (manual_state IS NULL OR manual_state IN ('open', 'closed'));
