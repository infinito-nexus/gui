import unittest
from pathlib import Path


class TestAuthProxyCookieDocumentation(unittest.TestCase):
    def test_local_guide_documents_oauth2_proxy_cookie_expectations(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        guide = (
            repo_root / "docs" / "contributing" / "testing" / "local.md"
        ).read_text(encoding="utf-8")

        self.assertIn("OAuth2 Proxy Expectations", guide)
        self.assertIn("Secure", guide)
        self.assertIn("HttpOnly", guide)
        self.assertIn("SameSite=Strict", guide)
        self.assertIn("X-CSRF", guide)


if __name__ == "__main__":
    unittest.main()
