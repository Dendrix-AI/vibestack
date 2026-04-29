#!/usr/bin/env python3
"""Package and deploy a web app to VibeStack.

This script intentionally uses only Python standard library modules so it can run
inside coding-agent environments without extra dependencies.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import secrets as secret_random
import ssl
import string
import sys
import tarfile
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib import error, request


EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    "__pycache__",
}

EXCLUDE_FILES = {
    ".DS_Store",
    ".env",
}

TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}
CONFIG_PATHS = [
    Path("~/.config/vibestack/deploy.json").expanduser(),
    Path("~/.vibestack/deploy.json").expanduser(),
]
CREDENTIAL_PATHS = [
    Path("~/.config/vibestack/credentials.json").expanduser(),
    Path("~/.vibestack/credentials.json").expanduser(),
]
EXTERNAL_PASSWORD_ALPHABET = string.ascii_letters + string.digits + "-_"
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def parse_bool(value: str) -> bool:
    lowered = value.lower()
    if lowered in {"1", "true", "yes", "y"}:
        return True
    if lowered in {"0", "false", "no", "n"}:
        return False
    raise argparse.ArgumentTypeError(f"expected boolean, got {value!r}")


def generate_external_password(length: int = 24) -> str:
    return "".join(secret_random.choice(EXTERNAL_PASSWORD_ALPHABET) for _ in range(length))


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"INVALID_CONFIG: {path} is invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"INVALID_CONFIG: {path} must contain a JSON object")
    return value


def configured_path(explicit: str | None, env_name: str, defaults: list[Path]) -> list[Path]:
    if explicit:
        return [Path(explicit).expanduser()]
    env_value = os.environ.get(env_name)
    if env_value:
        return [Path(env_value).expanduser()]
    return defaults


def first_string(source: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def first_bool(source: dict[str, Any], *keys: str) -> bool | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, bool):
            return value
    return None


def load_defaults(config_path: str | None, credentials_path: str | None) -> dict[str, Any]:
    config: dict[str, Any] = {}
    for path in configured_path(config_path, "VIBESTACK_CONFIG", CONFIG_PATHS):
        config.update(read_json(path))

    credentials: dict[str, Any] = {}
    for path in configured_path(credentials_path, "VIBESTACK_CREDENTIALS", CREDENTIAL_PATHS):
        credentials.update(read_json(path))

    defaults: dict[str, Any] = {
        "endpoint": os.environ.get("VIBESTACK_API_URL")
        or os.environ.get("VIBESTACK_URL")
        or first_string(config, "apiUrl", "api_url", "endpoint", "url"),
        "team": os.environ.get("VIBESTACK_TEAM") or first_string(config, "team", "teamSlug", "team_slug"),
        "app_id": os.environ.get("VIBESTACK_APP_ID") or first_string(config, "appId", "app_id"),
        "token": os.environ.get("VIBESTACK_TOKEN") or first_string(credentials, "token", "apiToken", "api_token"),
        "login_access": first_bool(config, "loginAccess", "login_access"),
        "external_password": first_bool(config, "externalPassword", "external_password"),
        "postgres": first_bool(config, "postgres", "postgresEnabled", "postgres_enabled"),
    }

    env_login_access = os.environ.get("VIBESTACK_LOGIN_ACCESS")
    env_external_password = os.environ.get("VIBESTACK_EXTERNAL_PASSWORD")
    env_postgres = os.environ.get("VIBESTACK_POSTGRES")
    if env_login_access:
        defaults["login_access"] = parse_bool(env_login_access)
    if env_external_password:
        defaults["external_password"] = parse_bool(env_external_password)
    if env_postgres:
        defaults["postgres"] = parse_bool(env_postgres)

    return defaults


def require_deploy_value(value: str | None, name: str, flag: str) -> str:
    if value:
        return value
    raise SystemExit(
        f"MISSING_CONFIG: {name} is required. Pass {flag}, set the matching VIBESTACK_* environment variable, "
        "or configure ~/.config/vibestack/deploy.json and ~/.config/vibestack/credentials.json."
    )


def load_manifest(source: Path) -> dict[str, Any]:
    manifest_path = source / "vibestack.json"
    if not manifest_path.exists():
        raise SystemExit("MISSING_MANIFEST: vibestack.json is required at the project root")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"INVALID_MANIFEST: vibestack.json is invalid JSON: {exc}") from exc

    required = {
        "name": str,
        "port": int,
        "healthCheckPath": str,
        "persistent": bool,
    }
    for key, expected_type in required.items():
        if key not in manifest:
            raise SystemExit(f"INVALID_MANIFEST: missing required field {key!r}")
        if not isinstance(manifest[key], expected_type):
            raise SystemExit(f"INVALID_MANIFEST: field {key!r} must be {expected_type.__name__}")

    if manifest["port"] < 1 or manifest["port"] > 65535:
        raise SystemExit("INVALID_MANIFEST: port must be between 1 and 65535")
    if not manifest["healthCheckPath"].startswith("/"):
        raise SystemExit("INVALID_MANIFEST: healthCheckPath must start with /")

    return manifest


def validate_dockerfile(source: Path, manifest: dict[str, Any]) -> None:
    dockerfile = source / "Dockerfile"
    if not dockerfile.exists():
        raise SystemExit("MISSING_DOCKERFILE: Dockerfile is required at the project root")

    text = dockerfile.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        raise SystemExit("INVALID_DOCKERFILE: Dockerfile is empty")

    exposed_ports = set()
    for match in re.finditer(r"(?im)^\s*EXPOSE\s+(.+)$", text):
        for raw_port in match.group(1).split():
            port = raw_port.split("/", 1)[0]
            if port.isdigit():
                exposed_ports.add(int(port))

    manifest_port = int(manifest["port"])
    if exposed_ports and manifest_port not in exposed_ports:
        ports = ", ".join(str(port) for port in sorted(exposed_ports))
        raise SystemExit(
            f"PORT_MISMATCH: Dockerfile exposes {ports}, but vibestack.json port is {manifest_port}"
        )


def should_exclude(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    parts = set(rel.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if path.name in EXCLUDE_FILES:
        return True
    if path.name.startswith(".env."):
        return True
    return False


def make_tarball(source: Path) -> Path:
    fd, tmp_name = tempfile.mkstemp(prefix="vibestack-", suffix=".tar.gz")
    os.close(fd)
    tar_path = Path(tmp_name)

    with tarfile.open(tar_path, "w:gz") as tar:
        for path in sorted(source.rglob("*")):
            if should_exclude(path, source):
                continue
            arcname = path.relative_to(source)
            tar.add(path, arcname=str(arcname), recursive=False)

    return tar_path


def encode_multipart(fields: dict[str, str], files: dict[str, Path]) -> tuple[bytes, str]:
    boundary = f"----vibestack-{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode(),
                b"\r\n",
            ]
        )

    for name, path in files.items():
        filename = path.name
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode(),
                f"Content-Type: {content_type}\r\n\r\n".encode(),
                path.read_bytes(),
                b"\r\n",
            ]
        )

    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def http_json(
    method: str,
    url: str,
    token: str,
    body: bytes | None = None,
    content_type: str | None = None,
    insecure_tls: bool = False,
) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if content_type:
        headers["Content-Type"] = content_type

    req = request.Request(url, data=body, headers=headers, method=method)
    context = ssl._create_unverified_context() if insecure_tls else None

    try:
        with request.urlopen(req, context=context, timeout=60) as response:
            data = response.read()
            return json.loads(data.decode("utf-8")) if data else {}
    except error.HTTPError as exc:
        data = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            payload = {"error": {"code": f"HTTP_{exc.code}", "message": data}}
        raise RuntimeError(json.dumps(payload, indent=2)) from exc


def slugify(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def resolve_team_id(endpoint: str, token: str, team: str | None, insecure_tls: bool) -> str | None:
    if not team or UUID_RE.match(team):
        return team

    payload = http_json("GET", f"{endpoint}/api/v1/teams", token, insecure_tls=insecure_tls)
    for item in payload.get("teams", []):
        if item.get("id") == team or item.get("slug") == team:
            return item.get("id")
    return team


def resolve_existing_app_id(
    endpoint: str,
    token: str,
    app_name: str,
    team: str | None,
    insecure_tls: bool,
) -> str:
    team_id = resolve_team_id(endpoint, token, team, insecure_tls)
    desired_slug = slugify(app_name)
    payload = http_json("GET", f"{endpoint}/api/v1/apps", token, insecure_tls=insecure_tls)
    matches: list[dict[str, Any]] = []

    for item in payload.get("apps", []):
        item_slug = item.get("slug") or slugify(str(item.get("name", "")))
        item_name = str(item.get("name", ""))
        item_hostname = str(item.get("hostname", ""))
        if team_id and item.get("teamId") != team_id:
            continue
        if item_slug == desired_slug or item_name.lower() == app_name.lower() or item_hostname == app_name:
            matches.append(item)

    if len(matches) == 1 and matches[0].get("id"):
        return str(matches[0]["id"])
    if not matches:
        team_hint = f" in team {team!r}" if team else ""
        raise SystemExit(
            f"APP_NOT_FOUND: no existing VibeStack app named {app_name!r}{team_hint}. "
            "Pass --app-id, correct --app, or omit --update to create a new app."
        )
    choices = ", ".join(f"{item.get('name')} ({item.get('id')})" for item in matches)
    raise SystemExit(f"APP_AMBIGUOUS: multiple apps match {app_name!r}: {choices}. Pass --app-id.")


def deploy(args: argparse.Namespace) -> None:
    defaults = load_defaults(args.config, args.credentials)
    args.endpoint = args.endpoint or defaults.get("endpoint")
    args.team = args.team or defaults.get("team")
    args.app_id = args.app_id or defaults.get("app_id")
    args.token = args.token or defaults.get("token")
    if args.login_access is None:
        args.login_access = defaults.get("login_access")
    if args.external_password is None:
        args.external_password = defaults.get("external_password")
    if args.postgres is None:
        args.postgres = defaults.get("postgres")
    args.login_access = True if args.login_access is None else args.login_access
    args.external_password = False if args.external_password is None else args.external_password
    args.postgres = False if args.postgres is None else args.postgres
    generated_external_password: str | None = None

    source = Path(args.source).resolve()
    if not source.exists() or not source.is_dir():
        raise SystemExit(f"source directory does not exist: {source}")

    manifest = load_manifest(source)
    validate_dockerfile(source, manifest)
    tarball = make_tarball(source)
    if args.dry_run:
        try:
            print(f"Dry run succeeded: packaged {source} into {tarball.stat().st_size} bytes")
            print(f"Manifest app={manifest['name']} port={manifest['port']} health={manifest['healthCheckPath']}")
            return
        finally:
            tarball.unlink(missing_ok=True)

    args.endpoint = require_deploy_value(args.endpoint, "VibeStack API URL", "--api-url")
    args.token = require_deploy_value(args.token, "VibeStack API token", "--token")
    if not args.app_id and not args.update:
        args.team = require_deploy_value(args.team, "VibeStack team", "--team")

    if args.external_password and not args.external_password_value:
        args.external_password_value = generate_external_password()
        generated_external_password = args.external_password_value

    secrets: dict[str, str] = {}
    for item in args.secret:
        if "=" not in item:
            raise SystemExit(f"secret must be KEY=VALUE, got {item!r}")
        key, value = item.split("=", 1)
        secrets[key] = value

    metadata: dict[str, Any] = {
        "appName": args.app or manifest["name"],
        "access": {
            "loginRequired": args.login_access,
            "externalPasswordEnabled": args.external_password,
            "externalPassword": args.external_password_value,
        },
        "postgres": {
            "enabled": args.postgres,
        },
        "secrets": secrets,
    }
    if args.team:
        metadata["team"] = args.team

    endpoint = args.endpoint.rstrip("/")
    if args.update and not args.app_id:
        args.app_id = resolve_existing_app_id(
            endpoint,
            args.token,
            str(metadata["appName"]),
            args.team,
            args.insecure_tls,
        )

    if args.app_id:
        url = f"{endpoint}/api/v1/apps/{args.app_id}/deployments"
    else:
        url = f"{endpoint}/api/v1/apps/deploy"

    body, content_type = encode_multipart(
        {"metadata": json.dumps(metadata)},
        {"source": tarball},
    )

    try:
        created = http_json(
            "POST",
            url,
            args.token,
            body=body,
            content_type=content_type,
            insecure_tls=args.insecure_tls,
        )
    finally:
        tarball.unlink(missing_ok=True)

    deployment_id = created.get("deploymentId")
    if not deployment_id:
        raise SystemExit(f"deployment response did not include deploymentId: {created}")

    print(f"Deployment started: {deployment_id}")
    poll_url = f"{endpoint}/api/v1/deployments/{deployment_id}"
    deadline = time.time() + args.timeout

    while time.time() < deadline:
        status = http_json("GET", poll_url, args.token, insecure_tls=args.insecure_tls)
        deployment_status = (
            status.get("deploymentStatus")
            or status.get("status")
            or (status.get("deployment") or {}).get("status")
        )
        print(f"Deployment status: {deployment_status}")

        if deployment_status in TERMINAL_STATUSES:
            if deployment_status == "succeeded":
                print(f"Deployment succeeded: {status.get('url')}")
                if generated_external_password:
                    print("External app password generated for this deployment. Save it now; VibeStack stores only a hash.")
                    print(f"External app password: {generated_external_password}")
                return
            print("Deployment failed:")
            print(json.dumps(status.get("error") or status, indent=2))
            raise SystemExit(1)

        time.sleep(args.poll_interval)

    raise SystemExit(f"deployment did not finish within {args.timeout} seconds")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deploy a project to VibeStack")
    parser.add_argument("--api-url", dest="endpoint", help="VibeStack base URL")
    parser.add_argument("--token", help="VibeStack personal API token")
    parser.add_argument("--team", help="team ID or slug")
    parser.add_argument("--config", help="path to VibeStack deploy config JSON")
    parser.add_argument("--credentials", help="path to VibeStack credentials JSON")
    parser.add_argument("--app", help="app name; defaults to vibestack.json name")
    parser.add_argument("--app-id", help="existing app ID for update deployments")
    parser.add_argument("--update", action="store_true", help="resolve app name to an existing app and deploy an update")
    parser.add_argument("--source", default=".", help="project root")
    parser.add_argument("--login-access", type=parse_bool)
    parser.add_argument("--external-password", type=parse_bool)
    parser.add_argument("--external-password-value")
    parser.add_argument("--postgres", type=parse_bool)
    parser.add_argument("--secret", action="append", default=[], help="secret as KEY=VALUE")
    parser.add_argument("--poll-interval", type=int, default=30)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--insecure-tls", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="validate and package without calling the API")
    return parser


if __name__ == "__main__":
    try:
        deploy(build_parser().parse_args())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
