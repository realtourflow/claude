-- Flags an oauth_tokens row whose refresh path is dead (revoked / no refresh
-- token), so the Integrations UI can surface a "Reconnect" CTA instead of a
-- permanently-green "Connected" badge. Additive column, safe default false.
ALTER TABLE oauth_tokens ADD COLUMN needs_reconnect boolean NOT NULL DEFAULT false;
