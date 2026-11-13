"""중기전망 파서(static/outlook-parse.js) 테스트를 Node로 실행한다. node가 없으면 건너뛴다."""
import shutil
import subprocess
import unittest
from pathlib import Path

TEST_FILE = Path(__file__).with_name("outlook_parse.test.mjs")


@unittest.skipUnless(shutil.which("node"), "Node.js가 설치되어 있지 않아 건너뜁니다.")
class OutlookParseTests(unittest.TestCase):
    def test_node_parser_tests(self):
        result = subprocess.run(["node", str(TEST_FILE)], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"\d+ passed")
        self.assertNotIn("not ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
