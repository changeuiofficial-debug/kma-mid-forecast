"""단기예보 서비스(실황·초단기예보·단기예보) 테스트.

- 실제 응답 대조: tests/fixtures/short_20261113.json (2026-11-13 실제 응답 항목, 인증키 없음)
- 호출 간격·캐시·요청 조립은 모의 응답으로만 검증한다(실제 API 호출 없음).
"""
import io
import json
import tempfile
import threading
import time
import unittest
import urllib.request
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import server
import shortterm as S

KST = ZoneInfo("Asia/Seoul")
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "short_20261113.json").read_text("utf-8"))
JONGNO = "1111051500"  # 서울특별시 종로구 청운효자동 → 격자 (60, 127)


def at(h, m, day=13):
    return datetime(2026, 11, day, h, m, tzinfo=KST)


def wrap(items):
    return {"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
                         "body": {"totalCount": len(items), "items": {"item": items}}}}


class BaseTimeTests(unittest.TestCase):
    def test_now_uses_hour_after_10_minutes(self):
        self.assertEqual(S.candidate_bases("now", at(9, 9))[0], "202611130800")
        self.assertEqual(S.candidate_bases("now", at(9, 10))[0], "202611130900")

    def test_ultra_uses_half_hour_after_45_minutes(self):
        self.assertEqual(S.candidate_bases("ultra", at(9, 44))[0], "202611130830")
        self.assertEqual(S.candidate_bases("ultra", at(9, 45))[0], "202611130930")
        self.assertEqual(S.candidate_bases("ultra", at(0, 20))[:2], ["202611122330", "202611122230"])

    def test_short_uses_eight_daily_releases_after_10_minutes(self):
        self.assertEqual(S.candidate_bases("short", at(2, 9)), ["202611122300", "202611122000"])
        self.assertEqual(S.candidate_bases("short", at(2, 10)), ["202611130200", "202611122300"])
        self.assertEqual(S.candidate_bases("short", at(9, 9)), ["202611130800", "202611130500"])


class ValueTests(unittest.TestCase):
    def test_missing_and_zero(self):
        self.assertIsNone(S.to_number(""))
        self.assertIsNone(S.to_number(None))
        self.assertIsNone(S.to_number("-999"))
        self.assertIsNone(S.to_number("900"))
        self.assertEqual(S.to_number("0"), 0)
        self.assertEqual(S.to_number("-0.4"), -0.4)

    def test_compass_matches_guide_examples(self):
        self.assertEqual(S.compass(339), "북북서풍")
        self.assertEqual(S.compass(165), "남남동풍")
        self.assertEqual(S.compass(0), "북풍")
        self.assertEqual(S.compass(360), "북풍")
        self.assertIsNone(S.compass(None))

    def test_precipitation_text(self):
        self.assertEqual(S.rain_text("강수없음"), "강수 없음")
        self.assertEqual(S.rain_text("0"), "강수 없음")
        self.assertEqual(S.rain_text("1mm 미만"), "1mm 미만")
        self.assertEqual(S.rain_text("6.2"), "6.2mm")
        self.assertEqual(S.rain_text("2", qualitative=True), "보통 비")
        self.assertEqual(S.snow_text("적설없음"), "적설 없음")
        self.assertEqual(S.snow_text("2", qualitative=True), "많은 눈")


class RealResponseTests(unittest.TestCase):
    def test_now_matches_raw(self):
        raw = {i["category"]: i["obsrValue"] for i in FIXTURE["getUltraSrtNcst"]}
        d = S.transform_now(FIXTURE["getUltraSrtNcst"])
        self.assertEqual(d["temperature"], float(raw["T1H"]))
        self.assertEqual(d["humidity"], float(raw["REH"]))
        self.assertEqual(d["rain1h"], 0)  # 유효한 0 보존
        self.assertEqual(d["pty"], 0)
        self.assertEqual(d["ptyLabel"], "강수 없음")
        self.assertEqual(d["windLabel"], "북북동풍")

    def test_ultra_has_six_hourly_rows(self):
        rows = S.transform_ultra(FIXTURE["getUltraSrtFcst"])
        self.assertEqual(len(rows), 6)
        self.assertEqual([r["time"] for r in rows], ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"])
        self.assertEqual(rows[0]["rain"], "강수 없음")
        self.assertEqual(rows[0]["skyLabel"], "구름많음")

    def test_short_every_cell_matches_raw(self):
        items = FIXTURE["getVilageFcst"]
        index = {(i["fcstDate"], i["fcstTime"], i["category"]): i["fcstValue"] for i in items}
        rows, _ = S.transform_short(items)
        self.assertEqual(len(rows), 72)
        for r in rows:
            key = (r["date"].replace("-", ""), r["time"].replace(":", ""))
            for field, cat in (("temp", "TMP"), ("pop", "POP"), ("humidity", "REH"), ("sky", "SKY"), ("pty", "PTY")):
                self.assertEqual(float(index[key + (cat,)]), float(r[field]), f"{key} {field}")

    def test_short_daily_min_max(self):
        _, daily = S.transform_short(FIXTURE["getVilageFcst"])
        by = {d["date"]: d for d in daily}
        self.assertEqual((by["2026-11-14"]["min"], by["2026-11-14"]["max"]), (10, 14))
        self.assertEqual((by["2026-11-15"]["min"], by["2026-11-15"]["max"]), (9, 18))
        self.assertIsNone(by["2026-11-13"]["min"])  # 08시 발표본에는 오늘 최저기온이 없다 → 0이 아니라 미제공
        self.assertEqual(by["2026-11-13"]["max"], 17)

    def test_three_hour_steps_use_qualitative_codes(self):
        rows, _ = S.transform_short(FIXTURE["getVilageFcst"])
        by = {(r["date"], r["time"]): r for r in rows}
        hourly_edge = by[("2026-11-16", "00:00")]  # 직전 시각과 1시간 간격 → 숫자값
        self.assertEqual(hourly_edge["step"], "1h")
        self.assertEqual(hourly_edge["windSpeed"], 0.8)
        coded = by[("2026-11-16", "15:00")]  # 3시간 간격 → 풍속이 코드값
        self.assertEqual(coded["step"], "3h")
        self.assertIsNone(coded["windSpeed"])
        self.assertIn(coded["windText"], ("약한 바람", "약간 강한 바람", "강한 바람"))
        self.assertEqual(coded["rain"], "강수 없음")  # PCP 코드 '0'


class GridTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.regions = S.load_grid_regions(Path(server.DATA_DIR) / "grid_regions.json")

    def test_counts_and_known_cell(self):
        self.assertGreater(len(self.regions), 3800)
        jongno = next(r for r in self.regions if r["code"] == JONGNO)
        self.assertEqual((jongno["nx"], jongno["ny"]), (60, 127))
        self.assertEqual(jongno["name"], "서울특별시 종로구 청운효자동")
        self.assertGreater(jongno["n"], 1)  # 같은 격자를 쓰는 지역이 여럿

    def test_unique_codes_and_valid_ranges(self):
        codes = [r["code"] for r in self.regions]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertTrue(all(1 <= r["nx"] <= 149 and 1 <= r["ny"] <= 253 for r in self.regions))  # 가이드의 격자 범위 NX 149, NY 253


class ServerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.gw = server.Gateway(Path(self.tmp.name) / "s.sqlite3")
        self.old = server.GATEWAY, server.REGIONS
        server.REGIONS = server.load_regions()
        server.GATEWAY = self.gw

    def tearDown(self):
        server.GATEWAY, server.REGIONS = self.old
        self.tmp.cleanup()

    def payload(self, op):
        return wrap(FIXTURE[op])

    def test_transform_grid_comparison(self):
        r = server.transform("short", self.payload("getVilageFcst"), "60,127", "202611130800")
        self.assertEqual(r["codeComparison"], "match")
        self.assertEqual(r["responseCode"], "60,127")
        other = server.transform("short", self.payload("getVilageFcst"), "61,127", "202611130800")
        self.assertEqual(other["codeComparison"], "mismatch")
        self.assertEqual(len(r["data"]), 72)
        self.assertEqual(r["totalCount"], 871)

    def test_same_grid_regions_share_one_cache_key(self):
        a = server.gateway_code("short", JONGNO)
        b = server.gateway_code("short", "1111053000")  # 종로구 사직동(같은 격자)
        self.assertEqual(a, "60,127")
        self.assertEqual(a, b)
        self.assertEqual(server.cache_key_for("short", a, "202611130800"), server.cache_key_for("short", b, "202611130800"))

    def test_external_request_is_built_from_grid_and_base_time(self):
        captured = {}

        class Resp(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake(request, timeout):
            captured["url"] = request.full_url
            return Resp(json.dumps(self.payload("getUltraSrtNcst")).encode())

        with patch("urllib.request.urlopen", fake):
            self.gw._fetch_external("now", "60,127", "202611130800", "ab+c/d==")
        url = captured["url"]
        self.assertTrue(url.startswith("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?"))
        for part in ("base_date=20261113", "base_time=0800", "nx=60", "ny=127", "dataType=JSON", "serviceKey=ab%2Bc%2Fd%3D%3D"):
            self.assertIn(part, url)
        self.assertNotIn("%252B", url)

    def test_short_calls_are_5s_apart_and_do_not_block_mid_calls(self):
        short_ok = wrap(FIXTURE["getUltraSrtNcst"])
        mid_ok = {"response": {"header": {"resultCode": "00"}, "body": {"totalCount": 1, "items": {"item": {"wfSv": "전망"}}}}}
        with patch.object(self.gw, "_fetch_external", side_effect=[short_ok, mid_ok]) as fetch:
            self.gw.get("now", "60,127", "202611130800", "k")
            with patch.object(self.gw, "_fetch_external") as blocked:
                with self.assertRaises(server.ApiError) as raised:
                    self.gw.get("ultra", "60,127", "202611130830", "k")
                blocked.assert_not_called()
            self.assertEqual(raised.exception.code, "cooldown")
            self.assertLessEqual(raised.exception.retry_after, server.SHORT_MIN_INTERVAL + 1)
            self.gw.get("outlook", "108", "202611130600", "k")  # 중기 그룹은 단기 호출과 별개 간격
        self.assertEqual(fetch.call_count, 2)

    def test_short_cache_lasts_longer_than_mid_cache(self):
        key = server.cache_key_for("now", "60,127", "202611130800")
        with self.gw._connect() as con:
            con.execute("INSERT INTO cache VALUES(?,?,?)", (key, json.dumps({"data": {}}), time.time() - 120))
        with patch.object(self.gw, "_fetch_external", side_effect=AssertionError("cache should be used")):
            _, meta = self.gw.get("now", "60,127", "202611130800", "k")
        self.assertEqual(meta["cache"], "fresh")
        self.assertEqual(server.cache_ttl("outlook"), 30)
        self.assertGreater(server.cache_ttl("short"), server.cache_ttl("outlook"))

    def test_chat_context_accepts_short_pages_and_prompt_stays_small(self):
        pub = server.publications_for("short")[0]
        ctx = server.safe_chat_context({"page": "short", "region": JONGNO, "publication": pub})
        self.assertEqual(ctx["page"], "short")
        with self.assertRaises(server.ApiError):
            server.safe_chat_context({"page": "short", "region": JONGNO, "publication": "202001010000"})
        prompt = server.chat_system_prompt(ctx)
        self.assertLess(len(prompt), 60_000)
        self.assertNotIn("청운효자동", prompt)  # 읍면동 단계는 프롬프트에 싣지 않는다
        self.assertIn("종로구", prompt)

    def test_http_endpoints_for_short_features(self):
        server.STARTUP_SETTINGS = None
        httpd = server.Server(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            with patch.dict("os.environ", {"KMA_SERVICE_KEY": "dummy-key"}), \
                 patch.object(self.gw, "_fetch_external", return_value=self.payload("getVilageFcst")):
                regions = json.load(urllib.request.urlopen(base + "/api/regions"))
                self.assertIn("grid", regions)
                self.assertNotIn("short", regions)
                self.assertGreater(len(regions["grid"]), 3800)
                status = json.load(urllib.request.urlopen(base + "/api/status"))
                self.assertEqual(set(status["releases"]) >= {"now", "ultra", "short", "outlook"}, True)
                tm = status["releases"]["short"][0]
                body = json.load(urllib.request.urlopen(f"{base}/api/forecast?feature=short&region={JONGNO}&tmFc={tm}"))
                self.assertEqual(body["result"]["requestedCode"], JONGNO)  # 요청한 지역코드가 응답에 담긴다
                self.assertEqual(len(body["result"]["data"]), 72)
                self.assertNotIn("dummy-key", json.dumps(body))
                for path in ("/", "/now", "/ultra", "/short"):
                    self.assertEqual(urllib.request.urlopen(base + path).status, 200)
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
