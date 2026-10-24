#!/usr/bin/env python3
"""One-shot import of live 11ka.cz articles + accreditation requests into data/seed-*.json."""

from __future__ import annotations

import html
import json
import re
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://11ka.cz"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)
SQLITE_MAIN = ROOT / "storage" / "11ka.sqlite"
SQLITE_NEWER = ROOT / "tmp" / "staff-seed-test" / "11ka.sqlite"
OUT_ARTICLES = ROOT / "data" / "seed-articles.json"
OUT_ACC = ROOT / "data" / "seed-accreditations.json"

STATUS_MAP = {
    "schváleno": "approved",
    "zamítnuto": "rejected",
    "zažádáno": "requested",
    "čeká": "pending",
    "čeká na vyřízení": "pending",
}


def fetch(url: str, tries: int = 3) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xml,*/*"})
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                return res.read().decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.6 * (i + 1))
    raise last  # type: ignore[misc]


def abs_media(url: str | None) -> str | None:
    if not url:
        return None
    value = html.unescape(str(url).strip())
    if not value:
        return None
    value = value.replace("\\", "/")
    while value.startswith("../"):
        value = value[3:]
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if not value.startswith("/"):
        value = "/" + value
    if value.startswith("//"):
        return "https:" + value
    return ORIGIN + value


def rewrite_body(body: str | None) -> str:
    if not body:
        return ""
    text = str(body)
    text = re.sub(
        r'(src|href)="(?:(?:\.\./)+)?/?(uploads/[^"]+)"',
        lambda m: f'{m.group(1)}="https://11ka.cz/{m.group(2)}"',
        text,
    )
    text = re.sub(
        r"(src|href)='(?:(?:\.\./)+)?/?(uploads/[^']+)'",
        lambda m: f"{m.group(1)}='https://11ka.cz/{m.group(2)}'",
        text,
    )
    text = re.sub(
        r'(src|href)="(/uploads/[^"]+)"',
        lambda m: f'{m.group(1)}="{ORIGIN}{m.group(2)}"',
        text,
    )
    return text


def open_ro(path: Path) -> sqlite3.Connection | None:
    if not path.exists():
        return None
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def article_from_row(row: dict, teams_by_id: dict[int, list[str]]) -> dict:
    status = str(row.get("status") or "published").strip() or "published"
    item = {
        "slug": row["slug"],
        "title": row["title"],
        "excerpt": row.get("excerpt") or None,
        "body_html": rewrite_body(row.get("body_html")),
        "hero_image_path": abs_media(row.get("hero_image_path")),
        "hero_position": row.get("hero_position") or "50% 50%",
        "hero_credit": (row.get("hero_credit") or None),
        "category": row.get("category") or None,
        "tag": row.get("tag") or None,
        "author_name": row.get("author_name") or "Redakce",
        "status": status,
        "published_at": row.get("published_at"),
        "created_at": row.get("created_at") or row.get("published_at"),
        "view_count": int(row.get("view_count") or 0),
        "source_url": f"{ORIGIN}/clanek/{row['slug']}",
    }
    teams = teams_by_id.get(int(row["id"]), [])
    if teams:
        item["mentioned_teams"] = teams
    if row.get("rubric_slug"):
        item["rubric_slug"] = row["rubric_slug"]
    return item


def dump_sqlite_articles(path: Path) -> dict[str, dict]:
    con = open_ro(path)
    if not con:
        return {}
    con.row_factory = sqlite3.Row
    cols = {r[1] for r in con.execute("PRAGMA table_info(articles)")}
    team_cols = {r[1] for r in con.execute("PRAGMA table_info(article_teams)")} if "article_teams" in {
        r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
    } else set()
    teams_by_id: dict[int, list[str]] = {}
    if team_cols:
        for aid, code in con.execute("SELECT article_id, team_code FROM article_teams"):
            teams_by_id.setdefault(int(aid), []).append(str(code))
    select = """
      SELECT a.*, u.display_name AS author_name
      FROM articles a
      LEFT JOIN users u ON u.id = a.author_id
    """
    out: dict[str, dict] = {}
    for row in con.execute(select):
        data = {k: row[k] for k in row.keys() if k in cols or k == "author_name"}
        slug = str(data.get("slug") or "").strip()
        if not slug:
            continue
        out[slug] = article_from_row(data, teams_by_id)
    con.close()
    return out


def dump_sqlite_accreditations(path: Path) -> list[dict]:
    con = open_ro(path)
    if not con:
        return []
    con.row_factory = sqlite3.Row
    rows = []
    try:
        for row in con.execute(
            """
            SELECT email, phone, name, match_name, match_date, accreditation_type,
                   email_sent, status, hidden_from_web, created_at
            FROM accreditation_requests
            ORDER BY created_at ASC, id ASC
            """
        ):
            rows.append(
                {
                    "email": str(row["email"] or "").strip(),
                    "phone": str(row["phone"] or "").strip(),
                    "name": str(row["name"] or "").strip(),
                    "match_name": str(row["match_name"] or "").strip(),
                    "match_date": str(row["match_date"] or "").strip() or None,
                    "accreditation_type": str(row["accreditation_type"] or "photo").strip() or "photo",
                    "email_sent": 1 if int(row["email_sent"] or 0) else 0,
                    "status": str(row["status"] or "pending").strip() or "pending",
                    "hidden_from_web": 1 if int(row["hidden_from_web"] or 0) else 0,
                    "created_at": row["created_at"],
                }
            )
    finally:
        con.close()
    return rows


def inner_div(html_text: str, start_marker: str) -> str:
    start = html_text.find(start_marker)
    if start < 0:
        return ""
    gt = html_text.find(">", start)
    if gt < 0:
        return ""
    i = gt + 1
    depth = 1
    pos = i
    while pos < len(html_text) and depth > 0:
        nxt_open = html_text.find("<div", pos)
        nxt_close = html_text.find("</div>", pos)
        if nxt_close < 0:
            break
        if nxt_open >= 0 and nxt_open < nxt_close:
            depth += 1
            pos = nxt_open + 4
        else:
            depth -= 1
            if depth == 0:
                return html_text[i:nxt_close].strip()
            pos = nxt_close + 6
    return html_text[i:].strip()


def meta_content(html_text: str, key: str) -> str | None:
    patterns = [
        rf'<meta[^>]+(?:name|property)="{re.escape(key)}"[^>]+content="([^"]*)"',
        rf"<meta[^>]+(?:name|property)='{re.escape(key)}'[^>]+content='([^']*)'",
        rf'<meta[^>]+content="([^"]*)"[^>]+(?:name|property)="{re.escape(key)}"',
    ]
    for pat in patterns:
        m = re.search(pat, html_text, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return None


def parse_article_html(slug: str, html_text: str) -> dict | None:
    if "Vypněte prosím blokování" in html_text and "<h1" not in html_text:
        return None
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html_text, re.S | re.I)
    title = html.unescape(re.sub(r"<[^>]+>", "", h1.group(1)).strip()) if h1 else ""
    if not title:
        og = meta_content(html_text, "og:title") or ""
        title = re.sub(r"\s*-\s*11ka\.cz\s*$", "", og).strip()
    if not title:
        return None
    excerpt = meta_content(html_text, "description") or meta_content(html_text, "og:description")
    author = meta_content(html_text, "author") or "Redakce"
    published = None
    tm = re.search(r'<time[^>]+datetime="([^"]+)"', html_text, re.I)
    if tm:
        published = tm.group(1).strip()
    hero = abs_media(meta_content(html_text, "og:image"))
    credit = None
    cm = re.search(r'hero-credit-badge__text">([^<]+)', html_text)
    if cm:
        credit = html.unescape(cm.group(1)).strip()
    category = None
    tag = None
    pills = re.findall(
        r'<span class="inline-block rounded-full[^"]*"[^>]*>([^<]+)</span>',
        html_text,
    )
    if pills:
        category = html.unescape(pills[0]).strip()
        if len(pills) > 1:
            tag = html.unescape(pills[1]).strip()
    lead = None
    lm = re.search(
        r'<p class="mt-4 text-base leading-relaxed text-slate-300 sm:text-lg">(.*?)</p>',
        html_text,
        re.S,
    )
    if lm:
        lead = html.unescape(re.sub(r"<[^>]+>", "", lm.group(1))).strip()
        if lead and not excerpt:
            excerpt = lead
    body = rewrite_body(inner_div(html_text, '<div class="article-body'))
    if not body:
        return None
    return {
        "slug": slug,
        "title": title,
        "excerpt": excerpt or lead,
        "body_html": body,
        "hero_image_path": hero,
        "hero_position": "50% 50%",
        "hero_credit": credit,
        "category": category,
        "tag": tag,
        "author_name": author,
        "status": "published",
        "published_at": published,
        "created_at": published,
        "view_count": 0,
        "source_url": f"{ORIGIN}/clanek/{slug}",
    }


def sitemap_slugs() -> list[str]:
    xml = fetch(f"{ORIGIN}/sitemap.xml")
    locs = re.findall(r"<loc>(.*?)</loc>", xml)
    slugs = []
    seen = set()
    for loc in locs:
        if "/clanek/" not in loc:
            continue
        slug = loc.split("/clanek/", 1)[-1].strip().strip("/")
        if not slug or slug in seen:
            continue
        seen.add(slug)
        slugs.append(slug)
    return slugs


def parse_cs_date(value: str) -> str | None:
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})$", value.strip())
    if not m:
        return None
    d, mo, y = m.groups()
    return f"{y}-{int(mo):02d}-{int(d):02d}"


def scrape_accreditation_page(page: int) -> tuple[list[dict], int]:
    url = f"{ORIGIN}/akreditace" if page <= 1 else f"{ORIGIN}/akreditace?page={page}"
    html_text = fetch(url)
    total = 0
    zm = re.search(r"Zobrazeno\s+\d+-\d+\s+z\s+(\d+)", html_text)
    if zm:
        total = int(zm.group(1))
    table = re.search(r"<table class=\"akreditace-requests-table[\s\S]*?</table>", html_text)
    rows: list[dict] = []
    if not table:
        return rows, total
    for tr in re.findall(r"<tr class=\"border-b[\s\S]*?</tr>", table.group(0)):
        tds = re.findall(r"<td[^>]*>([\s\S]*?)</td>", tr)
        if len(tds) < 6:
            continue
        def cell_text(raw: str) -> str:
            return html.unescape(re.sub(r"<[^>]+>", " ", raw))

        name = re.sub(r"\s+", " ", cell_text(tds[0])).strip()
        match_name = re.sub(r"\s+", " ", cell_text(tds[1])).strip()
        match_date = parse_cs_date(re.sub(r"\s+", " ", cell_text(tds[2])).strip())
        type_label = re.sub(r"\s+", " ", cell_text(tds[3])).strip().lower()
        status_label = re.sub(r"\s+", " ", cell_text(tds[4])).strip().lower()
        mail = re.search(r"mailto:([^\"']+)", tds[5])
        email = html.unescape(mail.group(1)).strip() if mail else re.sub(r"\s+", " ", cell_text(tds[5])).strip()
        acc_type = "pisi" if "píš" in type_label or "pis" in type_label else "photo"
        status = STATUS_MAP.get(status_label, "pending")
        if not name or not email or not match_name:
            continue
        rows.append(
            {
                "email": email,
                "phone": "",
                "name": name,
                "match_name": match_name,
                "match_date": match_date,
                "accreditation_type": acc_type,
                "email_sent": 0,
                "status": status,
                "hidden_from_web": 0,
                "created_at": f"{match_date}T12:00:00.000Z" if match_date else datetime.now(timezone.utc).isoformat(),
            }
        )
    return rows, total


def acc_key(row: dict) -> str:
    return "|".join(
        [
            str(row.get("email") or "").strip().lower(),
            str(row.get("match_name") or "").strip().lower(),
            str(row.get("match_date") or "").strip(),
        ]
    )


def merge_accreditations(base: list[dict], extra: list[dict]) -> list[dict]:
    by_key: dict[str, dict] = {}
    order: list[str] = []
    for row in base + extra:
        key = acc_key(row)
        if not key.strip("|"):
            continue
        if key not in by_key:
            by_key[key] = dict(row)
            order.append(key)
            continue
        cur = by_key[key]
        if not cur.get("phone") and row.get("phone"):
            cur["phone"] = row["phone"]
        if row.get("status"):
            cur["status"] = row["status"]
        if row.get("hidden_from_web"):
            cur["hidden_from_web"] = 1
        if row.get("email_sent"):
            cur["email_sent"] = 1
        if row.get("created_at") and (not cur.get("created_at") or str(row["created_at"]) < str(cur["created_at"])):
            cur["created_at"] = row["created_at"]
    return [by_key[k] for k in order]


def main() -> None:
    articles = dump_sqlite_articles(SQLITE_MAIN)
    newer = dump_sqlite_articles(SQLITE_NEWER)
    for slug, item in newer.items():
        articles[slug] = item

    slugs = sitemap_slugs()
    missing = [s for s in slugs if s not in articles]
    scraped = 0
    failed = []
    for i, slug in enumerate(missing, 1):
        try:
            html_text = fetch(f"{ORIGIN}/clanek/{slug}")
            parsed = parse_article_html(slug, html_text)
            if parsed:
                articles[slug] = parsed
                scraped += 1
            else:
                failed.append(slug)
        except urllib.error.HTTPError as exc:
            failed.append(f"{slug} HTTP {exc.code}")
        except Exception as exc:  # noqa: BLE001
            failed.append(f"{slug} {exc}")
        if i % 10 == 0:
            print(f"[import] scraped {i}/{len(missing)} missing articles", flush=True)
        time.sleep(0.12)

    ordered = sorted(
        articles.values(),
        key=lambda a: (
            0 if a.get("status") == "published" else 1,
            str(a.get("published_at") or a.get("created_at") or ""),
        ),
        reverse=True,
    )
    payload = {
        "source": "live 11ka.cz sitemap + storage/11ka.sqlite + tmp/staff-seed-test",
        "imported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "articles": ordered,
    }
    OUT_ARTICLES.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    acc_sql = dump_sqlite_accreditations(SQLITE_MAIN)
    live_acc: list[dict] = []
    first_rows, total = scrape_accreditation_page(1)
    live_acc.extend(first_rows)
    per_page = max(len(first_rows), 7)
    pages = max(1, (total + per_page - 1) // per_page) if total else 1
    for page in range(2, pages + 1):
        rows, tot = scrape_accreditation_page(page)
        if tot:
            total = tot
        live_acc.extend(rows)
        time.sleep(0.12)
    merged_acc = merge_accreditations(acc_sql, live_acc)
    acc_payload = {
        "source": "live 11ka.cz/akreditace + storage/11ka.sqlite",
        "imported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "requests": merged_acc,
    }
    OUT_ACC.write_text(json.dumps(acc_payload, ensure_ascii=False, indent=2) + "\n")

    by_status: dict[str, int] = {}
    for item in ordered:
        by_status[item.get("status") or "published"] = by_status.get(item.get("status") or "published", 0) + 1
    print(
        json.dumps(
            {
                "articles_total": len(ordered),
                "articles_by_status": by_status,
                "sitemap": len(slugs),
                "scraped_missing": scraped,
                "scrape_failed": len(failed),
                "failed_sample": failed[:12],
                "accreditations_sqlite": len(acc_sql),
                "accreditations_live": len(live_acc),
                "accreditations_merged": len(merged_acc),
                "articles_file_kb": round(OUT_ARTICLES.stat().st_size / 1024),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
