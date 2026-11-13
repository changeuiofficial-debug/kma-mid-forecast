"""기상청 단기예보 조회서비스(VilageFcstInfoService_2.0)의 변환·발표시각 계산·격자 지역 로직.

server.py는 이 모듈의 순수 함수만 호출한다(네트워크·DB 없음 → 단독 테스트 가능).
기준 문서: 단기예보 조회서비스 오픈API 활용가이드(2026.10) 및 실제 응답(2026-11-13)으로 확인한 내용.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
# 공공데이터포털 주소와 serviceKey로 세 기능 모두 실제 응답을 확인했다(가이드의 apihub/authKey는 사용하지 않는다).
API_BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0"
NUM_OF_ROWS = 1500  # 단기예보 한 번 응답이 약 870건이라 한 페이지로 충분하다

SHORT_FEATURES: dict[str, dict[str, Any]] = {
    "now": {"endpoint": "getUltraSrtNcst", "service": "short", "title": "현재 날씨(초단기실황)"},
    "ultra": {"endpoint": "getUltraSrtFcst", "service": "short", "title": "6시간 예보(초단기예보)"},
    "short": {"endpoint": "getVilageFcst", "service": "short", "title": "단기예보"},
}
# 같은 발표본은 값이 바뀌지 않으므로(실황·초단기예보는 10분마다 갱신) 서버 캐시를 길게 둔다.
CACHE_SECONDS = {"now": 600, "ultra": 600, "short": 1800}
SHORT_RELEASE_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)

SKY_LABEL = {1: "맑음", 3: "구름많음", 4: "흐림"}
PTY_LABEL = {0: "강수 없음", 1: "비", 2: "비/눈", 3: "눈", 4: "소나기", 5: "빗방울", 6: "빗방울눈날림", 7: "눈날림"}
COMPASS = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"]
QUALITATIVE_RAIN = {"1": "약한 비", "2": "보통 비", "3": "강한 비"}
QUALITATIVE_SNOW = {"1": "보통 눈", "2": "많은 눈"}
QUALITATIVE_WIND = {"1": "약한 바람", "2": "약간 강한 바람", "3": "강한 바람"}


# ---------------------------------------------------------------- 발표시각
def _floor_hour(t: datetime) -> datetime:
    return t.replace(minute=0, second=0, microsecond=0)


def latest_base(feature: str, now: datetime | None = None) -> datetime:
    """지금 호출할 수 있는 가장 최근 발표시각(KST).

    실황: 매시 정시 발표, 10분 이후 호출 / 초단기예보: 매시 30분 발표, 45분 이후 호출 / 단기예보: 02·05·…·23시 발표, 10분 이후 호출.
    """
    now = (now or datetime.now(KST)).astimezone(KST)
    if feature == "now":
        return _floor_hour(now - timedelta(minutes=10))
    if feature == "ultra":
        t = now - timedelta(minutes=15)
        base = t.replace(minute=30, second=0, microsecond=0)
        return base - timedelta(hours=1) if base > t else base
    if feature == "short":
        t = now - timedelta(minutes=10)
        for days_back in (0, 1):
            day = (t - timedelta(days=days_back)).date()
            for hour in reversed(SHORT_RELEASE_HOURS):
                base = datetime(day.year, day.month, day.day, hour, tzinfo=KST)
                if base <= t:
                    return base
    raise ValueError(f"지원하지 않는 단기 기능: {feature}")


def previous_base(feature: str, base: datetime) -> datetime:
    return _previous_short(base) if feature == "short" else base - timedelta(hours=1)


def _previous_short(base: datetime) -> datetime:
    hours = list(SHORT_RELEASE_HOURS)
    i = hours.index(base.hour)
    if i > 0:
        return base.replace(hour=hours[i - 1])
    return (base - timedelta(days=1)).replace(hour=hours[-1])


def candidate_bases(feature: str, now: datetime | None = None, count: int = 2) -> list[str]:
    """화면 선택지: 최신 발표본과 직전 발표본(최신본이 아직 없을 때의 대체용). 형식 YYYYMMDDHHmm."""
    base = latest_base(feature, now)
    out = []
    for _ in range(count):
        out.append(base.strftime("%Y%m%d%H%M"))
        base = previous_base(feature, base)
    return out


# ---------------------------------------------------------------- 값 해석
def to_number(value: Any) -> float | int | None:
    """빈 값과 결측(±900 이상)은 None. 유효한 0은 보존한다."""
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if abs(result) >= 900:
        return None
    return int(result) if result.is_integer() else result


def to_code(value: Any) -> int | None:
    n = to_number(value)
    return int(n) if n is not None else None


def compass(deg: Any) -> str | None:
    """풍향(도) → 16방위. 기상청 변환식 (풍향 + 22.5×0.5) / 22.5 의 소수점 이하 버림."""
    n = to_number(deg)
    if n is None:
        return None
    return COMPASS[int((n + 22.5 * 0.5) / 22.5) % 16] + "풍"


def rain_text(value: Any, qualitative: bool = False) -> str | None:
    if value is None or value == "":
        return None
    s = str(value).strip()
    if qualitative:
        return "강수 없음" if s in ("0", "-", "null", "강수없음") else QUALITATIVE_RAIN.get(s, s)
    if s in ("강수없음", "0", "-", "null"):
        return "강수 없음"
    if "mm" in s:
        return s
    n = to_number(s)
    return f"{n}mm" if n is not None else None


def snow_text(value: Any, qualitative: bool = False) -> str | None:
    if value is None or value == "":
        return None
    s = str(value).strip()
    if qualitative:
        return "적설 없음" if s in ("0", "-", "null", "적설없음") else QUALITATIVE_SNOW.get(s, s)
    if s in ("적설없음", "0", "-", "null"):
        return "적설 없음"
    if "cm" in s:
        return s
    n = to_number(s)
    return f"{n}cm" if n is not None else None


def _date(s: str) -> str:
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def _time(s: str) -> str:
    return f"{s[0:2]}:{s[2:4]}"


# ---------------------------------------------------------------- 변환
def transform_now(items: list[dict[str, Any]]) -> dict[str, Any]:
    obs = {i.get("category"): i.get("obsrValue") for i in items}
    pty = to_code(obs.get("PTY"))
    return {
        "temperature": to_number(obs.get("T1H")),
        "rain1h": to_number(obs.get("RN1")),
        "humidity": to_number(obs.get("REH")),
        "windSpeed": to_number(obs.get("WSD")),
        "windDir": to_number(obs.get("VEC")),
        "windLabel": compass(obs.get("VEC")),
        "windU": to_number(obs.get("UUU")),
        "windV": to_number(obs.get("VVV")),
        "pty": pty,
        "ptyLabel": PTY_LABEL.get(pty) if pty is not None else None,
    }


def _slots(items: list[dict[str, Any]]) -> list[tuple[str, str, dict[str, Any]]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for i in items:
        grouped.setdefault((str(i.get("fcstDate")), str(i.get("fcstTime"))), {})[i.get("category")] = i.get("fcstValue")
    return [(d, t, v) for (d, t), v in sorted(grouped.items())]


def transform_ultra(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for d, t, v in _slots(items):
        sky, pty = to_code(v.get("SKY")), to_code(v.get("PTY"))
        rows.append({
            "date": _date(d), "time": _time(t), "temp": to_number(v.get("T1H")), "humidity": to_number(v.get("REH")),
            "sky": sky, "skyLabel": SKY_LABEL.get(sky), "pty": pty, "ptyLabel": PTY_LABEL.get(pty) if pty is not None else None,
            "pop": to_number(v.get("POP")), "rain": rain_text(v.get("RN1")), "lightning": to_number(v.get("LGT")),
            "windSpeed": to_number(v.get("WSD")), "windDir": to_number(v.get("VEC")), "windLabel": compass(v.get("VEC")),
        })
    return rows


def transform_short(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """단기예보: 시각별 행과 일 최저·최고기온.

    예보 후반(글피 등)은 3시간 간격이며 강수량·적설·풍속이 숫자가 아니라 코드값이다(가이드).
    그래서 직전 시각과 간격이 1시간보다 큰 시각은 정성정보로 해석한다. 첫 시각은 항상 숫자로 본다.
    """
    rows: list[dict[str, Any]] = []
    prev: datetime | None = None
    for d, t, v in _slots(items):
        now_dt = datetime.strptime(d + t, "%Y%m%d%H%M")
        qual = prev is not None and (now_dt - prev) > timedelta(hours=1)
        prev = now_dt
        sky, pty = to_code(v.get("SKY")), to_code(v.get("PTY"))
        wind_raw = v.get("WSD")
        wind_num = None if qual else to_number(wind_raw)
        wave = to_number(v.get("WAV"))
        rows.append({
            "date": _date(d), "time": _time(t), "temp": to_number(v.get("TMP")), "humidity": to_number(v.get("REH")),
            "sky": sky, "skyLabel": SKY_LABEL.get(sky), "pty": pty, "ptyLabel": PTY_LABEL.get(pty) if pty is not None else None,
            "pop": to_number(v.get("POP")), "rain": rain_text(v.get("PCP"), qual), "snow": snow_text(v.get("SNO"), qual),
            "windSpeed": wind_num, "windText": QUALITATIVE_WIND.get(str(wind_raw).strip(), str(wind_raw)) if qual and wind_raw not in (None, "") else None,
            "windDir": to_number(v.get("VEC")), "windLabel": compass(v.get("VEC")),
            "wave": wave, "step": "3h" if qual else "1h",
        })
    daily: dict[str, dict[str, Any]] = {}
    for i in items:
        cat = i.get("category")
        if cat in ("TMN", "TMX"):
            entry = daily.setdefault(_date(str(i.get("fcstDate"))), {"min": None, "max": None})
            entry["min" if cat == "TMN" else "max"] = to_number(i.get("fcstValue"))
    dates = sorted({r["date"] for r in rows} | set(daily))
    return rows, [{"date": d, **daily.get(d, {"min": None, "max": None})} for d in dates]


# ---------------------------------------------------------------- 격자 지역
def load_grid_regions(path: Path) -> list[dict[str, Any]]:
    """data/grid_regions.json(tools/build_grid_regions.py로 생성) → 화면용 지역 목록.

    같은 격자(nx,ny)를 쓰는 지역은 같은 예보값을 받는다. n은 그 지역 수.
    """
    data = json.loads(path.read_text("utf-8"))
    rows = data["rows"]
    share: dict[tuple[int, int], int] = {}
    for r in rows:
        share[(r[4], r[5])] = share.get((r[4], r[5]), 0) + 1
    regions = []
    for code, sido, sigungu, dong, nx, ny, lon, lat in rows:
        name = " ".join(p for p in (sido, sigungu, dong) if p)
        regions.append({"code": code, "name": name, "nx": nx, "ny": ny, "n": share[(nx, ny)], "lvl": 3 if dong else 2 if sigungu else 1})
    return regions
