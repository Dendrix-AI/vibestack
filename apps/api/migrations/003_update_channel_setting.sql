INSERT INTO platform_settings (key, value_json)
VALUES ('updateChannel', '"stable"'::jsonb)
ON CONFLICT (key) DO NOTHING;
