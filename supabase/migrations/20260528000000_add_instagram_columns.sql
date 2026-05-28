-- Instagram-specific post metrics
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS saves          bigint,
  ADD COLUMN IF NOT EXISTS follows_gained bigint,
  ADD COLUMN IF NOT EXISTS source         text DEFAULT 'facebook';

-- Track which platform each CSV import came from
ALTER TABLE csv_imports
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'facebook';
