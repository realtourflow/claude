CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT         NOT NULL,                  -- 'google_calendar' | 'microsoft_calendar'
  access_token  TEXT         NOT NULL,
  refresh_token TEXT,                                   -- optional; Microsoft sometimes omits
  expires_at    TIMESTAMPTZ  NOT NULL,
  scope         TEXT         NOT NULL DEFAULT '',
  account_email TEXT,                                   -- which Google/MS account the user authorized
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);

-- Maps internal events (deal closing, task due) to the external calendar
-- event ID returned by Google/Microsoft so subsequent updates patch the
-- same event instead of creating duplicates.
CREATE TABLE IF NOT EXISTS calendar_event_map (
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT         NOT NULL,
  internal_uid      TEXT         NOT NULL,              -- e.g. 'close-<dealId>' or 'task-<taskId>'
  external_event_id TEXT         NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider, internal_uid)
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider ON oauth_tokens(provider);
