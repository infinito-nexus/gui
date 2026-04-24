import unittest
from pathlib import Path

import yaml


class TestCiSupplyChainAudits(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        workflow_path = repo_root / ".github" / "workflows" / "tests.yml"
        cls.workflow = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))

    def test_supply_chain_job_runs_python_and_node_audits(self) -> None:
        job = self.workflow["jobs"]["supply-chain"]
        self.assertEqual(job["runs-on"], "ubuntu-latest")

        steps = job["steps"]
        rendered = "\n".join(
            step.get("run", "") for step in steps if isinstance(step, dict)
        )

        self.assertIn("actions/setup-python@v5", str(steps))
        self.assertIn("actions/setup-node@v4", str(steps))
        self.assertIn("pip install pip-audit", rendered)
        self.assertIn("pip-audit -r apps/api/requirements.lock --desc off", rendered)
        self.assertIn("npm ci", rendered)
        self.assertIn("npm audit --audit-level=critical", rendered)


if __name__ == "__main__":
    unittest.main()
