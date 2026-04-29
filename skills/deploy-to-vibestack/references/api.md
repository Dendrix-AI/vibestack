# VibeStack Deployment API Reference

This reference captures the API contract expected by the `deploy-to-vibestack` skill. The platform's generated OpenAPI document is authoritative once implemented.

## Authentication

Use a personal API token:

```http
Authorization: Bearer <token>
```

Never log or print the token.

## Create App And Deployment

```http
POST /api/v1/apps/deploy
Content-Type: multipart/form-data
```

Parts:

- `metadata`: JSON
- `source`: gzipped tarball

Metadata:

```json
{
  "team": "finance",
  "appName": "sales-dashboard",
  "access": {
    "loginRequired": true,
    "externalPasswordEnabled": false,
    "externalPassword": null
  },
  "postgres": {
    "enabled": false
  },
  "secrets": {
    "OPENAI_API_KEY": "supplied-value"
  }
}
```

Success:

```json
{
  "appId": "app_123",
  "deploymentId": "dep_123",
  "status": "queued"
}
```

## List Apps

Use this before update deployments when the user provides an app name but no app ID.

```http
GET /api/v1/apps
```

Success:

```json
{
  "apps": [
    {
      "id": "de52380f-282b-44de-a741-17118f331b01",
      "teamId": "8f90c863-78f2-4837-a98b-02b812ef765d",
      "name": "sales-dashboard",
      "slug": "sales-dashboard",
      "hostname": "finance-sales-dashboard.apps.example.com",
      "url": "https://finance-sales-dashboard.apps.example.com",
      "status": "running"
    }
  ]
}
```

## Deploy Existing App

```http
POST /api/v1/apps/{appId}/deployments
Content-Type: multipart/form-data
```

Use the same multipart format as create-and-deploy. The app ID is required for this endpoint.

## Poll Deployment

```http
GET /api/v1/deployments/{deploymentId}
```

In-progress:

```json
{
  "deploymentId": "dep_123",
  "appId": "app_123",
  "deploymentStatus": "building",
  "appStatus": "updating",
  "url": null,
  "version": null,
  "error": null
}
```

Success:

```json
{
  "deploymentId": "dep_123",
  "appId": "app_123",
  "deploymentStatus": "succeeded",
  "appStatus": "running",
  "url": "https://finance-sales-dashboard.apps.example.com",
  "version": 4,
  "error": null
}
```

Failure:

```json
{
  "deploymentId": "dep_123",
  "appId": "app_123",
  "deploymentStatus": "failed",
  "appStatus": "failed",
  "url": null,
  "version": null,
  "error": {
    "code": "HEALTH_CHECK_FAILED",
    "message": "The container did not return a successful response on the configured health check path.",
    "agentHint": "Ensure the app listens on 0.0.0.0:3000, keeps the server process running, and returns HTTP 2xx at /health. If the app has no health route, add one or set vibestack.json healthCheckPath to a route that already returns success.",
    "details": {
      "port": 3000,
      "healthCheckPath": "/health",
      "checkedUrl": "http://127.0.0.1:3000/health",
      "timeoutSeconds": 60,
      "likelyCauses": [
        "The app is not listening on port 3000.",
        "The app is bound to localhost instead of 0.0.0.0.",
        "The app does not return HTTP 2xx at /health.",
        "The container process exits before the health check completes."
      ],
      "agentHint": "Ensure the app listens on 0.0.0.0:3000, keeps the server process running, and returns HTTP 2xx at /health. If the app has no health route, add one or set vibestack.json healthCheckPath to a route that already returns success.",
      "logExcerpt": "..."
    },
    "logExcerpt": "..."
  }
}
```

## Rollback

```http
POST /api/v1/apps/{appId}/rollback
Content-Type: application/json
```

Body:

```json
{
  "deploymentId": "dep_previous"
}
```

If `deploymentId` is omitted, the API may roll back to the most recent previous successful deployment if the platform supports that behavior.

## Stable Error Codes

- `MAINTENANCE_MODE_ACTIVE`
- `TEAM_DEPLOYMENTS_PAUSED`
- `PERMISSION_DENIED`
- `DUPLICATE_APP_NAME`
- `MISSING_DOCKERFILE`
- `INVALID_DOCKERFILE`
- `MISSING_MANIFEST`
- `INVALID_MANIFEST`
- `PORT_MISMATCH`
- `BUILD_FAILED`
- `CONTAINER_START_FAILED`
- `HEALTH_CHECK_FAILED`
- `DNS_PROVISIONING_FAILED`
- `CLOUDFLARE_CONFIGURATION_INVALID`
