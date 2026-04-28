import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "skills" / "deploy-to-vibestack" / "scripts" / "vibestack_deploy.py"
FIXTURES = REPO_ROOT / "fixtures" / "sample-apps"


class DeployHelperDryRunTest(unittest.TestCase):
    def test_dry_run_succeeds_for_valid_fixture(self) -> None:
        result = self.run_helper("node-basic")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Dry run succeeded", result.stdout)
        self.assertIn("Manifest app=node-basic port=3000 health=/", result.stdout)

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


if __name__ == "__main__":
    unittest.main()
