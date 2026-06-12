-- Adds the personalization token: an unguessable capability identifying one
-- certificate, minted at POST /parchment/issue and resolved only by
-- GET /parchment/cert/<token>. Nullable: certificates issued before this
-- migration have no token and are simply not purchasable (their notification
-- emails carry no purchase link). SQLite cannot add a UNIQUE column via
-- ALTER TABLE, so uniqueness comes from the index.
ALTER TABLE certificates ADD COLUMN token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_token ON certificates (token);
