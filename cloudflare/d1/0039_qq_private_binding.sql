ALTER TABLE qq_account_link ADD COLUMN user_openid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS qq_account_link_user_openid_idx
ON qq_account_link(user_openid)
WHERE user_openid IS NOT NULL;
