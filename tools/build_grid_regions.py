#!/usr/bin/env python3
"""기상청 단기예보 격자 Excel(시도·시군구·읍면동 + 격자 X,Y + 위경도)을 data/grid_regions.json으로 변환한다.

사용법: python3 tools/build_grid_regions.py "격자_위경도.xlsx" [출력.json]
표준 라이브러리만 사용한다(openpyxl 불필요).
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
COLUMNS = ["code", "sido", "sigungu", "dong", "nx", "ny", "lon", "lat"]


def read_rows(xlsx: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(xlsx) as z:
        shared = [
            "".join(t.text or "" for t in si.iter(NS + "t"))
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si")
        ]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.iter(NS + "row"):
        values: dict[str, str] = {}
        for cell in row.findall(NS + "c"):
            col = re.match(r"[A-Z]+", cell.get("r") or "").group()
            v = cell.find(NS + "v")
            if v is None:
                values[col] = ""
            elif cell.get("t") == "s":
                values[col] = shared[int(v.text)]
            else:
                values[col] = v.text or ""
        rows.append(values)
    return rows


def build(xlsx: Path) -> dict:
    rows = read_rows(xlsx)
    header = rows[0]
    expect = {"B": "행정구역코드", "C": "1단계", "D": "2단계", "E": "3단계", "F": "격자 X", "G": "격자 Y"}
    for col, title in expect.items():
        if header.get(col) != title:
            raise SystemExit(f"Excel 열 구성이 예상과 다릅니다: {col}열 제목이 '{title}'가 아니라 '{header.get(col)}'입니다.")
    out, seen = [], set()
    for r in rows[1:]:
        sido, sigungu, dong = r.get("C", ""), r.get("D", ""), r.get("E", "")
        if not sido or not r.get("F") or not r.get("G"):
            continue
        key = (sido, sigungu, dong, r["F"], r["G"])
        if key in seen:  # 같은 이름·같은 격자 중복(예: 이어도)은 한 번만 둔다
            continue
        seen.add(key)
        out.append([r.get("B", ""), sido, sigungu, dong, int(r["F"]), int(r["G"]),
                    round(float(r["N"]), 5) if r.get("N") else None, round(float(r["O"]), 5) if r.get("O") else None])
    return {"source": "기상청 단기예보 조회서비스 격자 Excel(최종 업데이트 파일_20260930)", "columns": COLUMNS, "rows": out}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    target = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "data" / "grid_regions.json"
    result = build(Path(sys.argv[1]))
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(result['rows'])}행 → {target}")
