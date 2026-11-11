"""27차시 보완 사항 테스트.

- 실제 응답 대조: tests/fixtures/real_20261110.json (2026-11-10 실제 API 응답 item, 인증키 없음)
- 호출량·간격·제한: 모의 응답과 모의 호출 기록으로만 검증한다(실제 API 대량 호출 없음).
"""
import io
import json
import os
import tempfile
import time
import unittest
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import server

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "real_20261110.json").read_text("utf-8"))


def wrap(item, code="00"):
    return {"response": {"header": {"resultCode": code, "resultMsg": "NORMAL_SERVICE"},
                         "body": {"totalCount": 1, "items": {"item": [item]}}}}


class KeyLoadingTests(unittest.TestCase):
    def run_with(self, content, env=None, name="KEY.env"):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            if content is not None:
                (root / name).write_bytes(content.encode("utf-8"))
            clean_env = {k: v for k, v in os.environ.items() if k != "KMA_SERVICE_KEY"}
            clean_env.update(env or {})
            with patch.object(server, "KEY_FILE", root / "KEY.env"), patch.object(server, "ROOT", root), \
                 patch.dict(os.environ, clean_env, clear=True):
                return server.key_status(), server.key_file_hints()

    def test_missing_empty_placeholder_states(self):
        self.assertEqual(self.run_with(None)[0][1:], ("missing", "none"))
        self.assertEqual(self.run_with("KMA_SERVICE_KEY=\n")[0][1], "empty")
        self.assertEqual(self.run_with("KMA_SERVICE_KEY=YOUR_API_KEY\n")[0][1], "placeholder")

    def test_crlf_bom_comment_blank(self):
        (key, status, source), _ = self.run_with("﻿# 주석\r\n\r\nKMA_SERVICE_KEY=ab+c/d==\r\n")
        self.assertEqual((key, status, source), ("ab+c/d==", "configured", "KEY.env"))

    def test_blank_os_env_falls_back_to_file(self):
        (key, status, source), _ = self.run_with("KMA_SERVICE_KEY=file-key\n", env={"KMA_SERVICE_KEY": "  "})
        self.assertEqual((key, source), ("file-key", "KEY.env"))

    def test_wrong_file_name_is_reported(self):
        (_, status, _), hints = self.run_with("KMA_SERVICE_KEY=x\n", name="KEY.env.txt")
        self.assertEqual(status, "missing")
        self.assertIn("KEY.env.txt", hints)

    def test_file_is_not_executed(self):
        (key, status, _), _ = self.run_with("KMA_SERVICE_KEY=$(touch /tmp/should_not_exist)\n")
        self.assertEqual(key, "$(touch /tmp/should_not_exist)")

    def test_example_file_has_only_placeholder(self):
        text = (Path(server.ROOT) / "KEY.env.example").read_text("utf-8")
        self.assertEqual(text.strip(), "KMA_SERVICE_KEY=YOUR_API_KEY")


class EncodingTests(unittest.TestCase):
    def test_decoded_key_encoded_once_plus_kept(self):
        captured = {}

        class Resp(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            return Resp(json.dumps(wrap({"wfSv": "x"})).encode())

        gw = server.Gateway(Path(tempfile.mkdtemp()) / "g.sqlite3")
        with patch("urllib.request.urlopen", fake_urlopen):
            gw._fetch_external("outlook", "108", "202611101800", "ab+c/d==")
        self.assertIn("serviceKey=ab%2Bc%2Fd%3D%3D", captured["url"])
        self.assertNotIn("%252B", captured["url"])

    def test_network_error_does_not_leak_key(self):
        gw = server.Gateway(Path(tempfile.mkdtemp()) / "g.sqlite3")
        secret = "SECRET-KEY-123"
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError(f"fail for ?serviceKey={secret}")):
            with self.assertRaises(server.ApiError) as raised:
                gw._fetch_external("land", "11B00000", "202611101800", secret)
        self.assertNotIn(secret, raised.exception.message)
        self.assertIsNone(raised.exception.__cause__)


class RealResponseTests(unittest.TestCase):
    """실제 응답 item을 변환해 그래프·표에 쓰는 값이 원문 필드와 같은지 대조한다."""

    def convert(self, feature, tm):
        f = FIXTURE[f"{feature}|{tm}"]
        return f, server.transform(feature, wrap(f["rawItem"]), f["requestedCode"], tm)

    def test_06_vs_18_periods(self):
        for feature, rows06, rows18 in (("land", 11, 9), ("temperature", 7, 6), ("sea", 11, 9)):
            _, r06 = self.convert(feature, "202611100600")
            _, r18 = self.convert(feature, "202611101800")
            self.assertEqual((len(r06["data"]), len(r18["data"])), (rows06, rows18), feature)
            self.assertEqual(r06["data"][0]["date"], "2026-11-14")  # 06시: 4일 후부터
            self.assertEqual(r18["data"][0]["date"], "2026-11-15")  # 18시: 5일 후부터
            self.assertEqual(r18["data"][-1]["date"], "2026-11-20")

    def test_every_value_matches_raw_field(self):
        for tm in ("202611100600", "202611101800"):
            f, land = self.convert("land", tm)
            for row in land["data"]:
                sfx = {"오전": "Am", "오후": "Pm", "하루": ""}[row["period"]]
                self.assertEqual(row["rainProbability"], f["rawItem"][f"rnSt{row['dayOffset']}{sfx}"])
                self.assertEqual(row["weather"], f["rawItem"][f"wf{row['dayOffset']}{sfx}"])
            f, temp = self.convert("temperature", tm)
            for row in temp["data"]:
                self.assertEqual(row["min"], f["rawItem"][f"taMin{row['dayOffset']}"])
                self.assertEqual(row["max"], f["rawItem"][f"taMax{row['dayOffset']}"])
            f, sea = self.convert("sea", tm)
            for row in sea["data"]:
                sfx = {"오전": "Am", "오후": "Pm", "하루": ""}[row["period"]]
                self.assertEqual(row["waveMin"], f["rawItem"][f"wh{row['dayOffset']}A{sfx}"])
                self.assertEqual(row["waveMax"], f["rawItem"][f"wh{row['dayOffset']}B{sfx}"])

    def test_valid_zero_temperature_kept(self):
        _, temp = self.convert("temperature", "202611101800")
        day9 = [r for r in temp["data"] if r["dayOffset"] == 9][0]
        self.assertEqual(day9["min"], 0)

    def test_outlook_code_not_comparable_and_text_kept(self):
        f, out = self.convert("outlook", "202611101800")
        self.assertEqual(out["codeComparison"], "not_returned")
        self.assertEqual(out["data"]["text"], f["rawItem"]["wfSv"])
        self.assertEqual(out["totalCount"], 1)


class ProviderCodeTests(unittest.TestCase):
    def test_json_body_code_22_is_limit(self):
        with self.assertRaises(server.ApiError) as raised:
            server.transform("land", wrap({}, code="22"), "11B00000", "202611101800")
        self.assertEqual(raised.exception.code, "provider_limit")

    def test_code_03_is_no_data_and_30_is_auth(self):
        self.assertEqual(server.classify_provider_code("03").code, "no_data")
        self.assertEqual(server.classify_provider_code("30").code, "provider_auth")
        self.assertEqual(server.classify_provider_code("32").code, "provider_auth")


class CallControlTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "c.sqlite3"
        self.gw = server.Gateway(self.db)
        self.sample = wrap({"wfSv": "전망", "regId": "11B00000"})

    def tearDown(self):
        self.tmp.cleanup()

    def test_different_features_share_30s_interval(self):
        with patch.object(self.gw, "_fetch_external", return_value=self.sample) as fetch:
            self.gw.get("outlook", "108", "202611101800", "k")
            with self.assertRaises(server.ApiError) as raised:
                self.gw.get("land", "11B00000", "202611101800", "k")
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(raised.exception.code, "cooldown")
        self.assertGreater(raised.exception.retry_after, 25)

    def test_concurrent_different_features_make_one_external_call(self):
        def slow(*_):
            time.sleep(0.05)
            return self.sample
        with patch.object(self.gw, "_fetch_external", side_effect=slow) as fetch:
            def call(args):
                try:
                    return self.gw.get(*args, "k")[1]["cache"]
                except server.ApiError as exc:
                    return exc.code
            jobs = [("outlook", "108", "202611101800"), ("land", "11B00000", "202611101800"),
                    ("sea", "12A20000", "202611101800"), ("temperature", "11B10101", "202611101800")]
            with ThreadPoolExecutor(max_workers=4) as pool:
                outcomes = list(pool.map(call, jobs))
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(outcomes.count("network"), 1)
        self.assertEqual(outcomes.count("cooldown"), 3)

    def test_two_gateways_on_same_db_share_interval(self):
        other = server.Gateway(self.db)  # 같은 PC의 다른 프로세스를 흉내 낸다
        with patch.object(self.gw, "_fetch_external", return_value=self.sample), \
             patch.object(other, "_fetch_external", return_value=self.sample) as fetch2:
            self.gw.get("outlook", "108", "202611101800", "k")
            with self.assertRaises(server.ApiError):
                other.get("land", "11B00000", "202611101800", "k")
        fetch2.assert_not_called()

    def test_cached_page_yields_to_page_without_data(self):
        key = server.cache_key_for("outlook", "108", "202611101800")
        with self.gw._connect() as con:
            con.execute("INSERT INTO cache VALUES(?,?,?)", (key, json.dumps({"data": {"text": "old"}}), time.time() - 120))
        self.gw.waiting["land|11B00000|202611101800|JSON|1|10"] = time.time()
        with patch.object(self.gw, "_fetch_external") as fetch:
            payload, meta = self.gw.get("outlook", "108", "202611101800", "k")
        fetch.assert_not_called()
        self.assertEqual(meta["cache"], "stale_cooldown")
        self.assertEqual(payload["data"]["text"], "old")

    def test_provider_limit_halts_all_features_and_persists(self):
        with patch.object(self.gw, "_fetch_external", side_effect=server.ApiError("provider_limit", "x", 503)), redirect_stdout(io.StringIO()):
            with self.assertRaises(server.ApiError):
                self.gw.get("outlook", "108", "202611101800", "k")
        restarted = server.Gateway(self.db)
        with self.gw._connect() as con:  # 30초 간격 조건은 제외하고 중지 상태만 본다
            con.execute("UPDATE calls SET called_at = called_at - 100")
        with patch.object(restarted, "_fetch_external") as fetch:
            with self.assertRaises(server.ApiError) as raised:
                restarted.get("sea", "12A20000", "202611101800", "k")
        fetch.assert_not_called()
        self.assertEqual(raised.exception.code, "provider_limit_halt")
        self.assertGreater(restarted.halt_until(), time.time())

    def test_failed_call_counted_and_backoff_grows(self):
        key = server.cache_key_for("land", "11B00000", "202611101800")
        with patch.object(self.gw, "_fetch_external", side_effect=server.ApiError("network", "x", 502)):
            delays = []
            for _ in range(3):
                with self.gw._connect() as con:
                    con.execute("UPDATE calls SET called_at = called_at - 100")
                    con.execute("UPDATE failures SET next_retry = 0")
                with self.assertRaises(server.ApiError) as raised:
                    self.gw.get("land", "11B00000", "202611101800", "k")
                delays.append(raised.exception.retry_after)
        self.assertEqual(delays, [30, 60, 120])
        self.assertEqual(self.gw.usage(), 3)
        self.assertTrue(self.gw.failure_wait(key) > 0)

    def test_warning_logged_at_8000_and_limit_at_9000(self):
        now = time.time() - 60
        with self.gw._connect() as con:
            con.executemany("INSERT INTO calls(called_at,feature,outcome) VALUES(?,?,?)", [(now, "mock", "success")] * (server.WARNING_AT - 1))
        out = io.StringIO()
        with patch.object(self.gw, "_fetch_external", return_value=self.sample), redirect_stdout(out):
            self.gw.get("outlook", "108", "202611101800", "k")
        self.assertIn("관리자 경고", out.getvalue())
        with self.gw._connect() as con:
            con.executemany("INSERT INTO calls(called_at,feature,outcome) VALUES(?,?,?)", [(now, "mock", "success")] * (server.APP_LIMIT - server.WARNING_AT))
            con.execute("UPDATE calls SET called_at = ?", (now,))
        with patch.object(self.gw, "_fetch_external") as fetch:
            with self.assertRaises(server.ApiError) as raised:
                self.gw.get("land", "11B00000", "202611101800", "k")
        fetch.assert_not_called()
        self.assertEqual(raised.exception.code, "app_limit")

    def test_usage_survives_restart(self):
        with patch.object(self.gw, "_fetch_external", return_value=self.sample):
            self.gw.get("outlook", "108", "202611101800", "k")
        self.assertEqual(server.Gateway(self.db).usage(), 1)


if __name__ == "__main__":
    unittest.main()
