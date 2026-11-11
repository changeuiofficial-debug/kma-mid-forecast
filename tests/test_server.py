import json
import os
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import server


KST = ZoneInfo("Asia/Seoul")


class EnvironmentTests(unittest.TestCase):
    def test_bom_comments_and_equals_in_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "KEY.env"
            path.write_text("\ufeff# 메모\n\nKMA_SERVICE_KEY=abc=123+xyz\n", encoding="utf-8")
            self.assertEqual(server.parse_key_file(path)["KMA_SERVICE_KEY"], "abc=123+xyz")

    def test_environment_has_priority(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "KEY.env"
            path.write_text("KMA_SERVICE_KEY=file-key\n", encoding="utf-8")
            with patch.object(server, "KEY_FILE", path), patch.dict(os.environ, {"KMA_SERVICE_KEY": "env-key"}):
                self.assertEqual(server.key_status(), ("env-key", "configured", "environment"))

    def test_encoded_key_decodes_once_without_plus_to_space(self):
        with patch.dict(os.environ, {"KMA_SERVICE_KEY": "abc%2Bdef%252F"}):
            key, status, _ = server.key_status()
            self.assertEqual(status, "configured")
            self.assertEqual(key, "abc+def%2F")

    def test_gemini_environment_has_priority_and_model_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "KEY.env"
            path.write_text("GEMINI_API_KEY=file-key\nGEMINI_MODEL=gemini-file\n", encoding="utf-8")
            with patch.object(server, "KEY_FILE", path), patch.dict(os.environ, {"GEMINI_API_KEY": "env-key", "GEMINI_MODEL": "gemini-env"}):
                self.assertEqual(server.gemini_settings(), ("env-key", "configured", "environment", "gemini-env"))


class ReleaseTests(unittest.TestCase):
    def test_release_candidates_within_24_hours(self):
        now = datetime(2026, 11, 7, 5, 30, tzinfo=KST)
        self.assertEqual(server.release_candidates(now), ["202611061800", "202611060600"])

    def test_evening_release_first(self):
        now = datetime(2026, 11, 7, 20, 0, tzinfo=KST)
        self.assertEqual(server.release_candidates(now)[:2], ["202611071800", "202611070600"])


class TransformTests(unittest.TestCase):
    def test_json_provider_error_is_classified(self):
        raw = json.dumps({"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"20"}}})
        self.assertEqual(server.provider_error_from_text(raw).code, "provider_auth")

    def test_xml_provider_error_is_classified(self):
        raw = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>"
        self.assertEqual(server.provider_error_from_text(raw).code, "provider_limit")

    def test_land_preserves_zero_and_missing(self):
        item = {"regId":"11B00000", "wf4Am":"맑음", "rnSt4Am":0, "wf8":"흐림"}
        rows = server.transform_land(item, "202611070600")
        self.assertEqual(rows[0]["rainProbability"], 0)
        self.assertEqual(rows[0]["date"], "2026-11-11")
        self.assertIsNone(rows[1]["rainProbability"])
        self.assertEqual(rows[1]["period"], "하루")

    def test_temperature_does_not_use_range_fields_as_absolute_values(self):
        item = {"taMin5": 2, "taMax5": 12, "taMin5Low": 3, "taMax5High": 4}
        self.assertEqual(server.transform_temperature(item, "202611071800"), [
            {"dayOffset":5,"date":"2026-11-12","min":2,"max":12}
        ])

    def test_sea_maps_a_to_min_b_to_max(self):
        item = {"wf4Am":"구름많음", "wh4AAm":1, "wh4BAm":3, "wh8A":2, "wh8B":4}
        rows = server.transform_sea(item, "202611070600")
        self.assertEqual((rows[0]["waveMin"], rows[0]["waveMax"]), (1, 3))
        self.assertEqual(rows[1]["period"], "하루")

    def test_single_item_and_code_mismatch(self):
        payload = {"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},"body":{"totalCount":1,"items":{"item":{"regId":"OTHER","taMin5":1,"taMax5":9}}}}}
        result = server.transform("temperature", payload, "11B10101", "202611071800")
        self.assertEqual(result["codeComparison"], "mismatch")
        self.assertEqual(len(result["data"]), 1)

    def test_empty_items(self):
        payload = {"response":{"header":{"resultCode":"00"},"body":{"totalCount":0,"items":""}}}
        result = server.transform("land", payload, "11B00000", "202611071800")
        self.assertEqual(result["data"], [])


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.gateway = server.Gateway(Path(self.tmp.name) / "test.sqlite3")

    def tearDown(self):
        self.tmp.cleanup()

    def sample(self):
        return {"response":{"header":{"resultCode":"00"},"body":{"totalCount":1,"items":{"item":{"wfSv":"전망"}}}}}

    def test_same_request_uses_cache(self):
        with patch.object(self.gateway, "_fetch_external", return_value=self.sample()) as fetch:
            first, first_meta = self.gateway.get("outlook", "108", "202611071800", "secret")
            second, second_meta = self.gateway.get("outlook", "108", "202611071800", "secret")
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(first_meta["cache"], "network")
        self.assertEqual(second_meta["cache"], "fresh")
        self.assertEqual(first["data"]["text"], second["data"]["text"])

    def test_cache_survives_gateway_restart(self):
        with patch.object(self.gateway, "_fetch_external", return_value=self.sample()):
            self.gateway.get("outlook", "108", "202611071800", "secret")
        restarted = server.Gateway(Path(self.tmp.name) / "test.sqlite3")
        with patch.object(restarted, "_fetch_external", side_effect=AssertionError("network should not run")):
            _, meta = restarted.get("outlook", "108", "202611071800", "secret")
        self.assertEqual(meta["cache"], "fresh")

    def test_concurrent_same_request_is_combined(self):
        def delayed(*_):
            time.sleep(0.08)
            return self.sample()
        with patch.object(self.gateway, "_fetch_external", side_effect=delayed) as fetch:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: self.gateway.get("outlook", "108", "202611071800", "secret"), range(2)))
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual({result[1]["cache"] for result in results}, {"network", "shared"})

    def test_app_limit_blocks_new_external_call(self):
        now = time.time()
        with self.gateway._connect() as con:
            con.executemany("INSERT INTO calls(called_at,feature,outcome) VALUES(?,?,?)",
                            [(now, "outlook", "success")] * server.APP_LIMIT)
        with patch.object(self.gateway, "_fetch_external") as fetch:
            with self.assertRaises(server.ApiError) as raised:
                self.gateway.get("outlook", "108", "202611071800", "secret")
        self.assertEqual(raised.exception.code, "app_limit")
        fetch.assert_not_called()

    def test_failed_call_is_counted_and_backed_off(self):
        with patch.object(self.gateway, "_fetch_external", side_effect=server.ApiError("network", "실패", 502)):
            with self.assertRaises(server.ApiError):
                self.gateway.get("outlook", "108", "202611071800", "secret")
        self.assertEqual(self.gateway.usage(), 1)
        self.assertGreater(self.gateway.failure_wait("outlook|108|202611071800|JSON|1|10"), 0)


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.gateway = server.Gateway(Path(self.tmp.name) / "chat.sqlite3")
        self.old_gateway, self.old_regions = server.GATEWAY, server.REGIONS
        server.GATEWAY = self.gateway
        server.REGIONS = server.load_regions()

    def tearDown(self):
        server.GATEWAY, server.REGIONS = self.old_gateway, self.old_regions
        self.tmp.cleanup()

    def context(self):
        return {"page": "outlook", "region": "108", "publication": server.release_candidates()[0]}

    def test_rejects_unknown_action_field(self):
        with self.assertRaises(server.ApiError) as raised:
            server.validate_action("navigate_page", {"page": "sea", "url": "https://example.com"}, self.context())
        self.assertEqual(raised.exception.code, "chat_invalid_action")

    def test_rejects_region_from_other_feature(self):
        with self.assertRaises(server.ApiError) as raised:
            server.validate_action("select_region", {"page": "sea", "region_code": "108"}, self.context())
        self.assertEqual(raised.exception.code, "chat_invalid_region")

    def test_digest_preserves_joint_max_and_zero(self):
        payload = {"data": [
            {"date": "2026-11-11", "period": "오전", "rainProbability": 0},
            {"date": "2026-11-12", "period": "오전", "rainProbability": 70},
            {"date": "2026-11-13", "period": "오후", "rainProbability": 70},
            {"date": "2026-11-14", "period": "하루", "rainProbability": None},
        ]}
        digest = server.forecast_digest(server.CacheRecord(payload, time.time()), self.context())
        extrema = digest["calculatedExtrema"]["rainProbability"]
        self.assertEqual(extrema["min"], 0)
        self.assertEqual(len(extrema["maxRows"]), 2)

    def test_mocked_function_call_is_validated_without_key_leak(self):
        response = {"candidates": [{"content": {"parts": [{"functionCall": {"name": "navigate_page", "args": {"page": "temperature"}}}]}}],
                    "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 4}}
        with patch.object(server, "gemini_settings", return_value=("secret", "configured", "environment", "gemini-test")), \
             patch.object(server, "call_gemini", return_value=response):
            result = server.handle_chat({"message": "기온으로 이동", "context": self.context(), "history": []})
        self.assertEqual(result["action"]["name"], "navigate_page")
        self.assertNotIn("secret", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
