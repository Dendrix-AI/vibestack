import subprocess
import sys
import tempfile
import unittest
import importlib.util
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
                '{"apiUrl":"https://vibestack.local.test","team":"test-team","loginAccess":true}',
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
