-- Add user_id column for multi-tenant isolation
-- Each user gets their own isolated set of environment variables

ALTER TABLE env_variables ADD COLUMN user_id TEXT NOT NULL DEFAULT 'anonymous';

-- Create index for fast user-scoped queries
CREATE INDEX idx_env_user_id ON env_variables(user_id);

-- Composite index for user + name uniqueness
CREATE UNIQUE INDEX idx_env_user_name ON env_variables(user_id, name);

-- Drop old unique constraint on name only (if it exists)
-- Note: SQLite doesn't support DROP CONSTRAINT, we work around with the unique index above

-- Update Vectorize namespace approach: user_id will be stored in vector metadata
-- No schema change needed for Vectorize - we'll filter by user_id in metadata
