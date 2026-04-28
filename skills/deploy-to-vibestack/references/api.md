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

## Deploy Existing App

```http
POST /api/v1/apps/{appId}/deployments
Content-Type: multipart/form-data
```

Use the same multipart format as create-and-deploy.

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
    "agentHint": "Ensure the app binds to 0.0.0.0, listens on the manifest port, and returns HTTP 200 at healthCheckPath.",
    "details": {
      "port": 3000,
      "healthCheckPath": "/"
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
