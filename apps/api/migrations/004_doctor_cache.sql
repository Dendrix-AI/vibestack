CREATE TABLE IF NOT EXISTS doctor_cache (
  deployment_id uuid PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  root_cause_category text NOT NULL,
  openrouter_model text,
  packet_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doctor_cache_updated_at ON doctor_cache(updated_at DESC);
