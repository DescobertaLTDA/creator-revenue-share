-- Add new revenue and video metric columns to posts table
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS stars_earnings_usd numeric(12,6),
  ADD COLUMN IF NOT EXISTS ad_cpm_usd         numeric(10,6),
  ADD COLUMN IF NOT EXISTS ad_impressions      integer,
  ADD COLUMN IF NOT EXISTS video_duration_s    integer,
  ADD COLUMN IF NOT EXISTS watch_seconds_total numeric(16,2),
  ADD COLUMN IF NOT EXISTS watch_seconds_avg   numeric(12,4);
