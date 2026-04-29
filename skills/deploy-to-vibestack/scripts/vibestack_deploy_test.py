import subprocess
import sys
import tempfile
import unittest
import importlib.util
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "skills" / "deploy-to-vibestack" / "scripts" / "vibestack_deploy.py"
FIXTURES = REPO_ROOT / "fixtures" / "sample-apps"


class DeployHelperDryRunTest(unittest.TestCase):
    def test_generated_external_password_is_safe_to_print_once(self) -> None:
        module = load_helper_module()
        password = module.generate_external_password()

        self.assertEqual(len(password), 24)
        self.assertRegex(password, r"^[A-Za-z0-9_-]+$")

    def test_dry_run_succeeds_for_valid_fixture(self) -> None:
        result = self.run_helper("node-basic")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Dry run succeeded", result.stdout)
        self.assertIn("Manifest app=node-basic port=3000 health=/", result.stdout)

    def test_dry_run_does_not_require_server_config(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--source",
                str(FIXTURES / "node-basic"),
                "--dry-run",
            ],
            check=False,
            text=True,
            capture_output=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Dry run succeeded", result.stdout)

    def test_config_file_can_provide_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "deploy.json"
            credentials = Path(tmp) / "credentials.json"
            config.write_text(
                '{"apiUrl":"https://vibestack.local.test","team":"test-team","appId":"de52380f-282b-44de-a741-17118f331b01","loginAccess":true}',
                encoding="utf-8",
            )
            credentials.write_text('{"token":"test-token"}', encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config),
                    "--credentials",
                    str(credentials),
                    "--source",
                    str(FIXTURES / "node-basic"),
                    "--dry-run",
                ],
                check=False,
                text=True,
                capture_output=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Dry run succeeded", result.stdout)

    def test_config_file_can_provide_app_id_default(self) -> None:
        module = load_helper_module()
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "deploy.json"
            config.write_text('{"appId":"de52380f-282b-44de-a741-17118f331b01"}', encoding="utf-8")

            defaults = module.load_defaults(str(config), None)

        self.assertEqual(defaults["app_id"], "de52380f-282b-44de-a741-17118f331b01")

    def test_smoke_test_uses_packaged_context_before_dry_run(self) -> None:
        module = load_helper_module()
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            (source / "Dockerfile").write_text("FROM node:22-alpine\nEXPOSE 3000\n", encoding="utf-8")
            (source / "vibestack.json").write_text(
                '{"name":"smoke-app","port":3000,"healthCheckPath":"/health","persistent":true}',
                encoding="utf-8",
            )
            (source / ".env").write_text("TOKEN=do-not-package", encoding="utf-8")
            (source / "node_modules").mkdir()
            (source / "node_modules" / "package.txt").write_text("do-not-package", encoding="utf-8")
            calls: list[tuple[Path, dict, dict, int]] = []

            def fake_local_smoke_test(smoke_source, manifest, secrets, timeout_seconds):
                calls.append((smoke_source, manifest, secrets, timeout_seconds))
                self.assertTrue((smoke_source / "Dockerfile").exists())
                self.assertFalse((smoke_source / ".env").exists())
                self.assertFalse((smoke_source / "node_modules").exists())

            module.local_smoke_test = fake_local_smoke_test
            args = module.build_parser().parse_args(
                [
                    "--source",
                    str(source),
                    "--dry-run",
                    "--smoke-test",
                    "--smoke-timeout",
                    "12",
                    "--secret",
                    "TOKEN=secret-value",
                ]
            )

            output = StringIO()
            with redirect_stdout(output):
                module.deploy(args)

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]["healthCheckPath"], "/health")
        self.assertEqual(calls[0][2], {"TOKEN": "secret-value"})
        self.assertEqual(calls[0][3], 12)
        self.assertIn("Dry run succeeded", output.getvalue())

    def test_command_failures_redact_secret_values(self) -> None:
        module = load_helper_module()

        def fake_run(*args, **kwargs):
            return subprocess.CompletedProcess(args[0], 1, "", "failed with secret-value in output")

        original_run = module.subprocess.run
        module.subprocess.run = fake_run
        try:
            with self.assertRaises(SystemExit) as raised:
                module.run_command(["docker", "build", "."], "LOCAL_SMOKE_BUILD_FAILED", ["secret-value"])
        finally:
            module.subprocess.run = original_run

        message = str(raised.exception)
        self.assertIn("[redacted]", message)
        self.assertNotIn("secret-value", message)

    def test_resolves_existing_app_id_by_name_and_team_slug(self) -> None:
        module = load_helper_module()
        calls: list[str] = []

        def fake_http_json(method, url, token, body=None, content_type=None, insecure_tls=False):
            calls.append(url)
            if url.endswith("/api/v1/teams"):
                return {"teams": [{"id": "team-1", "slug": "platform-admins"}]}
            if url.endswith("/api/v1/apps"):
                return {
                    "apps": [
                        {"id": "app-1", "teamId": "team-1", "name": "OKR Dashboard", "slug": "okr-dashboard"},
                        {"id": "app-2", "teamId": "team-2", "name": "OKR Dashboard", "slug": "okr-dashboard"},
                    ]
                }
            raise AssertionError(url)

        module.http_json = fake_http_json

        app_id = module.resolve_existing_app_id(
            "https://vibestack.local.test",
            "test-token",
            "okr-dashboard",
            "platform-admins",
            False,
        )

        self.assertEqual(app_id, "app-1")
        self.assertEqual(calls, ["https://vibestack.local.test/api/v1/teams", "https://vibestack.local.test/api/v1/apps"])

    def test_resolve_existing_app_id_reports_ambiguous_matches(self) -> None:
        module = load_helper_module()

        def fake_http_json(method, url, token, body=None, content_type=None, insecure_tls=False):
            return {
                "apps": [
                    {"id": "app-1", "name": "OKR Dashboard", "slug": "okr-dashboard"},
                    {"id": "app-2", "name": "OKR Dashboard", "slug": "okr-dashboard"},
                ]
            }

        module.http_json = fake_http_json

        with self.assertRaisesRegex(SystemExit, "APP_AMBIGUOUS"):
            module.resolve_existing_app_id(
                "https://vibestack.local.test",
                "test-token",
                "okr-dashboard",
                None,
                False,
            )

    def test_diagnostics_fetches_app_diagnostics_by_app_id(self) -> None:
        module = load_helper_module()
        calls: list[str] = []

        def fake_http_json(method, url, token, body=None, content_type=None, insecure_tls=False):
            calls.append(url)
            return {"app": {"id": "app-1"}, "appLogs": {"logs": ["started"]}}

        module.http_json = fake_http_json
        args = module.build_parser().parse_args(
            [
                "--diagnostics",
                "--api-url",
                "https://vibestack.local.test",
                "--token",
                "test-token",
                "--app-id",
                "app-1",
                "--diagnostics-tail",
                "25",
            ]
        )

        output = StringIO()
        with redirect_stdout(output):
            module.diagnostics(args)

        self.assertEqual(calls, ["https://vibestack.local.test/api/v1/apps/app-1/diagnostics?tail=25"])
        self.assertIn('"logs": [', output.getvalue())

    def test_dry_run_fails_without_dockerfile(self) -> None:
        result = self.run_helper("missing-dockerfile")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("MISSING_DOCKERFILE", result.stderr)

    def test_dry_run_fails_on_invalid_manifest(self) -> None:
        result = self.run_helper("invalid-manifest")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("INVALID_MANIFEST", result.stderr)

    def test_dry_run_fails_on_port_mismatch(self) -> None:
        result = self.run_helper("port-mismatch")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PORT_MISMATCH", result.stderr)
        self.assertIn("Dockerfile exposes 4000", result.stderr)

    def run_helper(self, fixture_name: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--api-url",
                "https://vibestack.local.test",
                "--token",
                "test-token",
                "--team",
                "test-team",
                "--source",
                str(FIXTURES / fixture_name),
                "--dry-run",
            ],
            check=False,
            text=True,
            capture_output=True,
        )


def load_helper_module():
    spec = importlib.util.spec_from_file_location("vibestack_deploy", SCRIPT)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":
    unittest.main()
