# VibeStack Manifest Reference

Every VibeStack app must include `vibestack.json` at the project root.

## Minimum Manifest

```json
{
  "name": "sales-dashboard",
  "port": 3000,
  "healthCheckPath": "/",
  "persistent": true
}
```

## Full V1 Manifest

```json
{
  "name": "sales-dashboard",
  "port": 3000,
  "healthCheckPath": "/",
  "persistent": true,
  "startCommand": null,
  "requiredSecrets": ["OPENAI_API_KEY"],
  "postgres": false
}
```

## Fields

- `name`: app name. Prefer lowercase words separated by hyphens.
- `port`: internal container HTTP port. This does not need to be unique on the VibeStack host.
- `healthCheckPath`: HTTP path used by VibeStack to verify the app is healthy.
- `persistent`: must be true for v1 unless the user explicitly says the app is disposable.
- `startCommand`: optional; normally the Dockerfile decides how the app starts.
- `requiredSecrets`: optional list of environment variable names the app needs.
- `postgres`: optional boolean indicating whether the app expects a VibeStack-managed Postgres database.

## Runtime Expectations

The app should:

- Listen on `0.0.0.0`.
- Listen on the manifest `port`.
- Return an HTTP success response at `healthCheckPath`.
- Use `/data` for persistent local file storage.
- Use `DATABASE_URL` when VibeStack-managed Postgres is enabled.

## Health Check Guidance

For new apps, prefer a dedicated health route such as:

```json
{
  "healthCheckPath": "/health"
}
```

The route should return HTTP 200 quickly without requiring login, cookies, JavaScript, external API calls, or database writes. For an Express app:

```js
app.get("/health", (_req, res) => res.status(200).send("ok"));
app.listen(port, "0.0.0.0");
```

Static apps may use `/` as the health check path if the root document is always served successfully.

## Common Port Defaults

- Vite preview: `4173`
- Vite dev server: `5173`, but production containers should usually use a static server or Node server instead.
- Express/Fastify/Next custom server: commonly `3000`.
- Python Flask/FastAPI: commonly `8000`.
