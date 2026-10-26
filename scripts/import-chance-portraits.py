#!/usr/bin/env python3
"""Download Chance Liga Póza 1 portraits from a public Drive folder, crop heads, map to livesport IDs."""

from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "seed-foto.json"
OUT_DIR = ROOT / "public" / "players"
MANIFEST_PATH = ROOT / "data" / "chance-hq-photos.json"
REPORT_PATH = ROOT / "data" / "chance-hq-photos-report.json"
DRIVE_ROOT = "12SRbcDEp2pYwZv2w1UNzdw50tUUtQP7i"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept": "*/*"})


def light_fold(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fold(value: str) -> str:
    text = light_fold(value)
    text = re.sub(r"\b(fc|fk|sk|ac|sc|mfk|1|praha|1905)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(value: str) -> list[str]:
    return [part for part in fold(value).split() if part]


def fetch(url: str, retries: int = 4) -> requests.Response:
    last = None
    for attempt in range(retries):
        try:
            res = SESSION.get(url, timeout=60)
            if res.status_code in (429, 500, 502, 503, 504):
                time.sleep(1.2 * (attempt + 1))
                last = res
                continue
            res.raise_for_status()
            return res
        except Exception as err:  # noqa: BLE001
            last = err
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def _item(file_id: str, name: str, is_folder: bool) -> dict:
    return {
        "id": file_id,
        "name": name,
        "tooltip": name,
        "is_folder": is_folder,
        "is_shortcut": "shortcut" in name.lower() or "kopie souboru" in name.lower(),
    }


def list_drive_embedded(folder_id: str) -> list[dict]:
    html = fetch(f"https://drive.google.com/embeddedfolderview?id={folder_id}#list").text
    items = []
    seen = set()
    for match in re.finditer(
        r'class="flip-entry" id="entry-([^"]+)"(.*?)class="flip-entry-title">([^<]+)',
        html,
        re.S,
    ):
        file_id, blob, name = match.group(1), match.group(2), match.group(3).strip()
        if not file_id or file_id in seen or name.startswith("."):
            continue
        seen.add(file_id)
        is_folder = 'aria-label="Folder"' in blob or "/drive/folders/" in blob
        if not is_folder and not Path(name).suffix:
            name += ".png"
        items.append(_item(file_id, name, is_folder))
    return items


def list_drive_classic(folder_id: str) -> list[dict]:
    html = fetch(f"https://drive.google.com/drive/folders/{folder_id}").text
    items = []
    seen = set()
    found = re.findall(
        r'data-id="([^"]+)" jsname="vtaz5c"[^>]*data-tooltip="([^"]+)"',
        html,
    )
    for file_id, tooltip in found:
        if file_id in seen:
            continue
        seen.add(file_id)
        raw = tooltip.strip()
        is_folder = "shared folder" in raw.lower()
        name = re.sub(
            r"\s+(Shared folder|Image|Shortcut to Image|Binary)$",
            "",
            raw,
            flags=re.I,
        ).strip()
        if name.startswith("."):
            continue
        if not is_folder and not Path(name).suffix:
            name += ".png"
        items.append(_item(file_id, name, is_folder))
    return items


def list_drive(folder_id: str) -> list[dict]:
    embedded = list_drive_embedded(folder_id)
    if len(embedded) >= 10:
        return embedded
    classic = list_drive_classic(folder_id)
    merged = {item["id"]: item for item in embedded + classic}
    return list(merged.values())


def find_named(items: list[dict], *needles: str) -> dict | None:
    folded = [
        (item, fold(item["name"]), light_fold(item["name"]))
        for item in items
        if item.get("is_folder")
    ]
    for needle in needles:
        want = fold(needle)
        want_light = light_fold(needle)
        for item, name, light in folded:
            if name == want or light == want_light:
                return item
    return None


IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")


def is_image(item: dict) -> bool:
    name = (item.get("name") or "").lower()
    return (
        not item.get("is_folder")
        and not item.get("is_shortcut")
        and name.endswith(IMAGE_EXT)
        and "kopie souboru" not in name
        and "(1)" not in name
    )


def is_pose1_folder(name: str) -> bool:
    key = light_fold(name)
    return key in {"poza 1", "pozice 1", "pose 1", "poza1", "pozice1"}


def is_poza1_file(name: str) -> bool:
    key = light_fold(name)
    return key.startswith("poza 1") or key.startswith("poza1") or key.startswith("pozice 1")


def poza1_only(files: list[dict]) -> list[dict]:
    poza1 = [item for item in files if is_poza1_file(item["name"])]
    if poza1:
        return poza1
    return [
        item
        for item in files
        if not re.match(r"poza\s*[2-9]", light_fold(item["name"]), re.I)
    ]


def pick_player_image(folder_id: str, folder_name: str) -> dict | None:
    items = list_drive(folder_id)
    cropped = find_named(items, "orezane", "orez", "full size orezane", "full_size_orezane")
    pool = list_drive(cropped["id"]) if cropped else items
    images = [item for item in pool if is_image(item)]
    if not images:
        return None
    home = [item for item in images if re.search(r"home|domac", item["name"], re.I)]
    chosen = (home or images)[0]
    return {
        "id": chosen["id"],
        "name": f"{folder_name}.png",
        "tooltip": chosen["name"],
        "is_folder": False,
        "is_shortcut": False,
    }


def collect_portraits(team_folder_id: str) -> tuple[str, list[dict]]:
    team_items = list_drive(team_folder_id)
    portraits = find_named(team_items, "portrety", "portréty", "portraits")
    items = list_drive(portraits["id"]) if portraits else team_items
    skip = ("zapasy", "zápasy", "rt", "realizacni", "realizační", "tymova", "týmová", "odchody")

    def skipped(name: str) -> bool:
        folded = fold(name)
        return folded in skip or any(token in folded.split() for token in skip)

    items = [item for item in items if not skipped(item["name"])]
    players = find_named(items, "hraci", "hráči")
    if players:
        items = list_drive(players["id"])
    if not any(is_pose1_folder(item["name"]) for item in items) and not any(is_image(item) for item in items):
        nested = [
            item
            for item in items
            if item.get("is_folder")
            and any(token in light_fold(item["name"]) for token in ("png", "domaci", "home", "hraci"))
        ]
        if nested:
            items = list_drive(nested[0]["id"])
    pose = next((item for item in items if item.get("is_folder") and is_pose1_folder(item["name"])), None)
    if pose:
        files = [item for item in list_drive(pose["id"]) if is_image(item)]
        return pose["name"], files
    images = poza1_only([item for item in items if is_image(item)])
    if images:
        return "HRÁČI", images
    player_folders = [
        item
        for item in items
        if item.get("is_folder") and not skipped(item["name"])
    ]
    picked = []
    for folder in player_folders:
        image = pick_player_image(folder["id"], folder["name"])
        if image:
            picked.append(image)
    if not picked:
        raise RuntimeError("Póza 1 folder not found")
    return "player-folders", picked


def parse_filename(name: str) -> tuple[int | None, list[str]]:
    stem = Path(name).stem
    while re.search(r"\.(png|jpg|jpeg|webp)$", stem, re.I):
        stem = stem.rsplit(".", 1)[0]
    stem = re.sub(r"\s*\(\d+\)$", "", stem)
    stem = re.sub(r"^\d+\s*,\s*(home|away)?\s*,?\s*", "", stem, flags=re.I)
    parts = [part for part in re.split(r"[_\s-]+", stem) if part]
    if parts and re.match(r"poza\d+$", parts[0], re.I):
        parts = parts[1:]
    number = None
    if parts and parts[0].isdigit():
        number = int(parts[0])
        parts = parts[1:]
    if parts and parts[-1].isdigit() and number is None:
        number = int(parts[-1])
        parts = parts[:-1]
    return number, [part for part in parts if fold(part)]


def score_player(player: dict, name_parts: list[str], number: int | None) -> float:
    player_tokens = tokens(player.get("name") or "")
    file_tokens = []
    for part in name_parts:
        file_tokens.extend(tokens(part))
    file_tokens = [part for part in file_tokens if len(part) > 1 and part != "png"]
    if not player_tokens or not file_tokens:
        return -1
    last = player_tokens[-1]
    surnames = player_tokens[-2:] if len(player_tokens) >= 3 else [last]
    last_ok = any(token in file_tokens for token in surnames) or file_tokens[0] in player_tokens
    if not last_ok:
        return -1
    given = player_tokens[:-1] or player_tokens
    if len(file_tokens) >= 2 and not any(token in file_tokens for token in given):
        return -1
    overlap = len(set(player_tokens) & set(file_tokens))
    if overlap <= 0:
        return -1
    score = overlap * 3
    if file_tokens[0] == last or file_tokens[0] in surnames:
        score += 5
    if last in file_tokens:
        score += 2
    if player_tokens[0] in file_tokens:
        score += 2
    if number is not None and player.get("number") == number:
        score += 1.5
    return score


def match_player(players: list[dict], name_parts: list[str], number: int | None) -> dict | None:
    ranked = sorted(
        ((score_player(player, name_parts, number), player) for player in players),
        key=lambda row: row[0],
        reverse=True,
    )
    ranked = [row for row in ranked if row[0] >= 7]
    if not ranked:
        return None
    best, player = ranked[0]
    if len(ranked) > 1 and ranked[1][0] == best:
        return None
    return player


def name_key(team: str, name: str) -> str:
    return f"{fold(team)}|{fold(name)}"


def name_keys(team: str, name: str) -> list[str]:
    folded = fold(name)
    parts = folded.split()
    reversed_name = " ".join(reversed(parts)) if parts else ""
    keys = [name_key(team, name), folded]
    if reversed_name and reversed_name != folded:
        keys.append(reversed_name)
        keys.append(name_key(team, reversed_name))
    if len(parts) >= 3:
        without_middle = f"{parts[0]} {parts[-1]}"
        keys.append(without_middle)
        keys.append(" ".join(reversed(without_middle.split())))
        keys.append(name_key(team, without_middle))
    return [key for key in keys if key]


def file_label(parts: list[str]) -> str:
    return " ".join(parts).strip()


def dest_for(player_id: str, team_slug: str, parts: list[str]) -> Path:
    if player_id:
        return OUT_DIR / f"{player_id}.jpg"
    slug = fold(" ".join(parts)).replace(" ", "-")
    return OUT_DIR / "chance" / (team_slug or "unknown") / f"{slug}.jpg"


def crop_head(im: Image.Image) -> Image.Image:
    w, h = im.size
    side = int(w * 0.72)
    left = max(0, (w - side) // 2)
    top = int(h * 0.035)
    height = int(side * 1.05)
    box = (left, top, min(w, left + side), min(h, top + height))
    cropped = im.crop(box)
    cropped.thumbnail((560, 560), Image.Resampling.LANCZOS)
    return cropped


def compose_dark(im: Image.Image) -> Image.Image:
    if im.mode != "RGBA":
        return im.convert("RGB")
    bg = Image.new("RGB", im.size, (11, 14, 18))
    bg.paste(im, mask=im.split()[-1])
    return bg


def download_and_save(file_id: str, dest: Path) -> None:
    url = f"https://lh3.googleusercontent.com/d/{file_id}=w1200"
    raw = fetch(url).content
    im = Image.open(BytesIO(raw)).convert("RGBA")
    face = compose_dark(crop_head(im))
    dest.parent.mkdir(parents=True, exist_ok=True)
    face.save(dest, "JPEG", quality=86, optimize=True)
    png_twin = dest.with_suffix(".png")
    if png_twin != dest and png_twin.exists() and dest.suffix.lower() == ".jpg":
        png_twin.unlink()


def load_chance_players() -> tuple[dict[str, list[dict]], list[dict]]:
    data = json.loads(SEED_PATH.read_text())
    teams = {team["id"]: team for team in data.get("teams") or []}
    by_fold: dict[str, list[dict]] = {}
    all_players: list[dict] = []
    for player in data.get("players") or []:
        team = teams.get(player.get("teamId") or "")
        if not team or team.get("league") != "Chance Liga":
            continue
        row = {
            "id": player.get("livesportId") or "",
            "name": player.get("name") or "",
            "number": player.get("number"),
            "team": team.get("name") or "",
            "slug": team.get("slug") or "",
        }
        by_fold.setdefault(fold(team.get("name") or ""), []).append(row)
        all_players.append(row)
    return by_fold, all_players


def main() -> int:
    only = sys.argv[1:]
    chance, all_players = load_chance_players()
    teams = list_drive(DRIVE_ROOT)
    report = {
        "matched": [],
        "unmatched_files": [],
        "missing_teams": [],
        "errors": [],
        "skipped": [],
    }
    jobs = []
    used_ids: set[str] = set()
    for team in teams:
        if not team.get("is_folder"):
            continue
        if fold(team["name"]) == "spoty":
            continue
        if only and fold(team["name"]) not in {fold(name) for name in only}:
            continue
        team_key = fold(team["name"])
        players = chance.get(team_key) or []
        if not players:
            report["missing_teams"].append(team["name"])
        try:
            poza_name, files = collect_portraits(team["id"])
        except Exception as err:  # noqa: BLE001
            report["errors"].append({"team": team["name"], "error": str(err)})
            continue
        print(f"{team['name']}: {len(files)} files in {poza_name}", flush=True)
        team_slug = (players[0]["slug"] if players else fold(team["name"]).replace(" ", "-"))
        for item in files:
            number, parts = parse_filename(item["name"])
            player = match_player(
                [row for row in players if row["id"] not in used_ids],
                parts,
                number,
            )
            if not player:
                player = match_player(
                    [row for row in all_players if row["id"] not in used_ids],
                    parts,
                    None,
                )
            if player and player.get("id"):
                used_ids.add(player["id"])
                dest = dest_for(player["id"], team_slug, parts)
                jobs.append((item["id"], dest, player, team["name"], item["name"]))
            else:
                fake = {
                    "id": "",
                    "name": file_label(parts),
                    "slug": team_slug,
                    "team": team["name"],
                }
                dest = dest_for("", team_slug, parts)
                jobs.append((item["id"], dest, fake, team["name"], item["name"]))
                report["unmatched_files"].append(
                    {"team": team["name"], "file": item["name"], "parts": parts, "path": str(dest.relative_to(ROOT))}
                )

    print(f"downloading {len(jobs)} portraits", flush=True)
    ok = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {
            pool.submit(download_and_save, file_id, dest): (player, team_name, file_name, dest)
            for file_id, dest, player, team_name, file_name in jobs
        }
        for future in as_completed(future_map):
            player, team_name, file_name, dest = future_map[future]
            try:
                future.result()
                ok += 1
                rel = "/" + str(dest.relative_to(ROOT / "public"))
                report["matched"].append(
                    {
                        "team": team_name,
                        "file": file_name,
                        "player": player["name"],
                        "livesportId": player["id"],
                        "path": rel,
                    }
                )
                print(f"ok {ok}/{len(jobs)} {player['name']}", flush=True)
            except Exception as err:  # noqa: BLE001
                report["errors"].append(
                    {"team": team_name, "file": file_name, "player": player["name"], "error": str(err)}
                )
                print(f"fail {player['name']}: {err}", flush=True)

    write_manifest(report)
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "matched": len(report["matched"]),
                "unmatched_files": len(report["unmatched_files"]),
                "missing_teams": report["missing_teams"],
                "errors": len(report["errors"]),
            },
            ensure_ascii=False,
        )
    )
    return 0


def write_manifest(report: dict) -> None:
    ids = {}
    names = {}
    for row in report.get("matched") or []:
        rel = row.get("path") or ""
        if not rel:
            continue
        if row.get("livesportId"):
            ids[row["livesportId"]] = rel
        if row.get("player"):
            for key in name_keys(row["team"], row["player"]):
                names[key] = rel
    MANIFEST_PATH.write_text(json.dumps({"ids": ids, "names": names}, indent=2, ensure_ascii=False) + "\n")


def remap_from_report() -> int:
    report = json.loads(REPORT_PATH.read_text())
    chance, all_players = load_chance_players()
    used_ids: set[str] = set()
    remapped = []
    unmatched = []
    for row in report.get("matched") or []:
        src = ROOT / "public" / str(row.get("path") or "").lstrip("/")
        if not src.exists():
            unmatched.append({**row, "reason": "missing-file"})
            continue
        number, parts = parse_filename(row.get("file") or "")
        team = row.get("team") or ""
        players = chance.get(fold(team)) or []
        team_slug = players[0]["slug"] if players else fold(team).replace(" ", "-")
        player = match_player([item for item in players if item["id"] not in used_ids], parts, number)
        if not player:
            player = match_player([item for item in all_players if item["id"] not in used_ids], parts, None)
        if player and player.get("id"):
            used_ids.add(player["id"])
            dest = dest_for(player["id"], team_slug, parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.resolve() != src.resolve():
                shutil.copy2(src, dest)
            rel = "/" + str(dest.relative_to(ROOT / "public"))
            remapped.append(
                {
                    "team": team,
                    "file": row.get("file"),
                    "player": player["name"],
                    "livesportId": player["id"],
                    "path": rel,
                }
            )
        else:
            dest = dest_for("", team_slug, parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.resolve() != src.resolve():
                shutil.copy2(src, dest)
            rel = "/" + str(dest.relative_to(ROOT / "public"))
            label = file_label(parts) or Path(row.get("file") or "player").stem
            remapped.append(
                {
                    "team": team,
                    "file": row.get("file"),
                    "player": label,
                    "livesportId": "",
                    "path": rel,
                }
            )
            unmatched.append({"team": team, "file": row.get("file"), "parts": parts, "path": str(dest.relative_to(ROOT))})
    out = {"matched": remapped, "unmatched_files": unmatched, "missing_teams": [], "errors": []}
    write_manifest(out)
    REPORT_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {
                "matched": len(remapped),
                "withId": sum(1 for row in remapped if row.get("livesportId")),
                "unmatched_files": len(unmatched),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--remap"]:
        raise SystemExit(remap_from_report())
    raise SystemExit(main())

