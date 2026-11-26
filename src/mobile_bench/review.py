"""Revision-bound review and collection handoff for the pilot scene evidence."""

from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import file_digest, sha256
import json
import os
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from typing import Iterator
from uuid import UUID


CASE_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,79}")
VIEWS = ("start", "turn", "approach", "stop", "reverse", "memory")
SCHEMA = "instride-annotation-review/1"


class ReviewError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ReviewError(f"{path.name}: {error}", 409) from error
    if not isinstance(value, dict):
        raise ReviewError(f"{path.name}: expected a JSON object", 409)
    return value


def load_catalog(site: Path) -> dict[str, dict]:
    path = site / "evaluation-candidates.json"
    entries = read_json(path).get("cases")
    if not isinstance(entries, list) or not entries:
        raise ReviewError(f"{path.name}: missing cases", 409)
    catalog = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ReviewError(f"{path.name}: every case must be an object", 409)
        case_id = entry.get("id")
        if not isinstance(case_id, str) or not CASE_ID.fullmatch(case_id) or case_id in catalog:
            raise ReviewError(f"{path.name}: invalid or duplicate case id {case_id!r}", 409)
        asset_dir(site, entry)
        catalog[case_id] = entry
    return catalog


def asset_dir(site: Path, entry: dict) -> Path:
    case_id = entry["id"]
    assets = entry.get("assets")
    if assets != f"cases/{case_id}/" and (case_id, assets) != ("airport", "run/"):
        raise ReviewError(f"{case_id}: invalid evidence path", 409)
    directory = (site / assets).resolve()
    if not directory.is_relative_to(site.resolve()):
        raise ReviewError(f"{case_id}: evidence path leaves the site", 409)
    return directory


def inspect_sources(site: Path, entry: dict, *, previews: bool = True) -> tuple[dict, dict]:
    case_id = entry["id"]
    directory = asset_dir(site, entry)
    route = read_json(directory / "trajectory.json")
    audit = read_json(directory / "audit.json")
    if (route.get("id") != entry.get("route_id")
            or route.get("scene_sha256") != entry.get("scene_sha256")
            or route.get("instruction") != entry.get("instruction")
            or route.get("area") != entry.get("draft_approach_xyxy")
            or route.get("target_part") != entry.get("target_part")):
        raise ReviewError(f"{case_id}: scene, route, instruction, target or area references disagree", 409)
    frames = route.get("frames")
    if (not isinstance(frames, list) or not frames
            or any(not isinstance(frame, list) or len(frame) < 4 or frame[0] != index
                   for index, frame in enumerate(frames))):
        raise ReviewError(f"{case_id}: malformed frame index in trajectory.json", 409)
    frame_count = len(frames)
    audit_keys = audit.get("keys")
    if not isinstance(audit_keys, dict) or "stop" not in audit_keys:
        raise ReviewError(f"{case_id}: missing key frames in audit.json", 409)
    keys = {**audit_keys, "reverse": audit_keys["stop"]}
    if (set(keys) - set(VIEWS) or not set(VIEWS[:-1]) <= keys.keys()
            or any(type(index) is not int or not 0 <= index < frame_count for index in keys.values())
            or keys["stop"] != frame_count - 1):
        raise ReviewError(f"{case_id}: malformed key frames in audit.json", 409)
    evidence = ["trajectory.json", "audit.json", "run.json", "expert.mp4",
                *(f"{key}.jpg" for key in keys)]
    if previews:
        evidence += ["expert-540p.mp4", *(f"preview/{key}.webp" for key in keys)]
    digests = {}
    for name in evidence:
        try:
            path = directory / name
            if not path.resolve().is_relative_to(directory):
                raise ReviewError(f"{case_id}/{name}: evidence path leaves its scene", 409)
            with path.open("rb") as file:
                digests[name] = file_digest(file, "sha256").hexdigest()
        except OSError as error:
            raise ReviewError(f"{case_id}/{name}: evidence is unavailable", 409) from error
    source = json.dumps({"case": entry, "files": digests}, ensure_ascii=False,
                        sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "source_revision": sha256(source).hexdigest(),
        "key_frames": keys,
        "frame_count": frame_count,
    }, route


def rectangle(value: object) -> list[float]:
    if (not isinstance(value, list) or len(value) != 4
            or any(type(n) not in (int, float) or not -1_000_000 <= n <= 1_000_000 for n in value)
            or value[2] - value[0] < 0.05 - 1e-10 or value[3] - value[1] < 0.05 - 1e-10):
        raise ReviewError("Enter a rectangle with valid sides and finite coordinates.")
    return value


def overlaps(first: list[float], second: list[float]) -> bool:
    return all(first[i] < second[i + 2] and second[i] < first[i + 2] for i in (0, 1))


@contextmanager
def journal_lock(path: Path) -> Iterator[None]:
    with (path.parent / ".review.lock").open("a+b") as file:
        if os.name == "nt":
            import msvcrt

            file.seek(0)
            msvcrt.locking(file.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(file.fileno(), fcntl.LOCK_EX)
        yield


class ReviewStore:
    def __init__(self, site: Path, reviews: Path):
        self.site = site.resolve()
        self.reviews = reviews.resolve()

    def history_path(self, case_id: str) -> Path:
        path = self.reviews / case_id / "decisions.jsonl"
        if not CASE_ID.fullmatch(case_id) or not path.resolve().is_relative_to(self.reviews):
            raise ReviewError("Unknown scene.", 404)
        return path

    def history(self, case_id: str) -> list[dict]:
        path = self.history_path(case_id)
        if not path.exists():
            return []
        with path.open(encoding="utf-8") as file:
            return [json.loads(line) for line in file if line.strip()]

    def current_source(self, case_id: str) -> tuple[dict, dict, dict]:
        entry = load_catalog(self.site).get(case_id)
        if entry is None:
            raise ReviewError(f"Unknown scene: {case_id}", 404)
        prepared = read_json(self.site / "review-media.json").get("cases", {}).get(case_id)
        source, route = inspect_sources(self.site, entry)
        if source != prepared:
            raise ReviewError(f"{case_id}: the evidence changed. Rebuild the review index and reopen the scene.", 409)
        return entry, source, route

    def status(self, case_id: str) -> dict:
        entry, source, _ = self.current_source(case_id)
        revision = source["source_revision"]
        history = self.history(case_id)
        latest = next((record for record in reversed(history)
                       if record["source_revision"] == revision), None)
        return {
            "case_id": case_id, "scene_id": entry["scene_id"], "source_revision": revision,
            "state": latest["decision"] if latest else "pending",
            "latest": latest, "history": history,
        }

    def submit(self, case_id: str, payload: dict) -> dict:
        if not isinstance(payload, dict):
            raise ReviewError("Expected a review object.")
        required = {"review_id", "source_revision", "reviewer_id", "decision", "reason",
                    "checks", "proposed_area_xyxy_u", "proposed_no_stop_zones_xyxy_u", "evidence_locator"}
        if payload.keys() != required:
            raise ReviewError("Review fields do not match the current form.")
        try:
            if str(UUID(payload["review_id"], version=4)) != payload["review_id"]:
                raise ValueError("review ID is not a canonical UUIDv4")
        except (AttributeError, ValueError, TypeError) as error:
            raise ReviewError("Invalid review ID.") from error
        path = self.history_path(case_id)
        if case_id not in load_catalog(self.site):
            raise ReviewError(f"Unknown scene: {case_id}", 404)
        path.parent.mkdir(parents=True, exist_ok=True)
        with journal_lock(path):
            history = self.history(case_id)
            for record in history:
                if record["review_id"] == payload["review_id"]:
                    if any(record[key] != value for key, value in payload.items()):
                        raise ReviewError("This review ID already belongs to a different submission.", 409)
                    return record
            entry, source, route = self.current_source(case_id)
            if payload["source_revision"] != source["source_revision"]:
                raise ReviewError("The evidence revision changed. Reopen the scene and review it again.", 409)
            self.validate(payload, source, route)
            record = {
                **payload, "schema": SCHEMA, "subject_type": "task_candidate", "subject_id": case_id,
                "case_id": case_id, "scene_id": entry["scene_id"], "route_id": entry["route_id"],
                "submitted_at_utc": datetime.now(timezone.utc).isoformat(),
            }
            with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as file:
                temp = Path(file.name)
                for row in [*history, record]:
                    file.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                file.flush()
                os.fsync(file.fileno())
            try:
                os.replace(temp, path)
            finally:
                temp.unlink(missing_ok=True)
            return record

    def validate(self, payload: dict, source: dict, route: dict) -> None:
        for field, limit in (("reviewer_id", 40), ("reason", 2000)):
            value = payload[field]
            if not isinstance(value, str) or value != value.strip() or len(value) > limit:
                raise ReviewError(f"Invalid {field}.")
        if not payload["reviewer_id"]:
            raise ReviewError("Enter a reviewer alias.")
        decision = payload["decision"]
        if decision not in ("approve", "request_changes"):
            raise ReviewError("Choose a review decision.")
        if decision == "request_changes" and not payload["reason"]:
            raise ReviewError("Explain what needs to change.")
        checks = payload["checks"]
        if (not isinstance(checks, dict) or checks.keys() != {"target", "approach"}
                or any(type(value) is not bool for value in checks.values())):
            raise ReviewError("Invalid review checks.")
        area = rectangle(payload["proposed_area_xyxy_u"])
        zones = payload["proposed_no_stop_zones_xyxy_u"]
        if not isinstance(zones, list) or len(zones) > 32:
            raise ReviewError("Use at most 32 proposed no-stop zones.")
        for zone in zones:
            rectangle(zone)
        evidence = payload["evidence_locator"]
        if not isinstance(evidence, dict) or evidence.keys() != {"view", "frame_index"}:
            raise ReviewError("Choose a valid evidence frame.")
        view, frame = evidence["view"], evidence["frame_index"]
        if (type(frame) is not int or not 0 <= frame < source["frame_count"]
                or not isinstance(view, str)
                or (view != "clip" and source["key_frames"].get(view) != frame)):
            raise ReviewError("Choose a valid evidence frame.")
        if decision == "approve":
            if not all(checks.values()):
                raise ReviewError("Confirm the target and reachable area before approving.")
            if area != route["area"] or zones:
                raise ReviewError("Submit proposed geometry as a change request and review the updated evidence.")
            if any(overlaps(area, zone["rect"]) for zone in route.get("hazards", [])):
                raise ReviewError("The source approach area overlaps a no-stop zone.")

    def eligible(self, case_ids: list[str]) -> dict:
        ready = []
        blocked = []
        for case_id in case_ids:
            try:
                entry, source, route = self.current_source(case_id)
                revision = source["source_revision"]
                review = next((record for record in reversed(self.history(case_id))
                               if record["source_revision"] == revision), None)
                if not review or review["decision"] != "approve":
                    blocked.append({"case_id": case_id, "state": review["decision"] if review else "pending"})
                    continue
                self.validate(review, source, route)
                ready.append({
                    "case_id": case_id, "scene_id": entry["scene_id"], "route_id": entry["route_id"],
                    "source_revision": revision, "review_id": review["review_id"],
                    "instruction": entry["instruction"], "target_part": entry["target_part"],
                    "approach_area_xyxy_u": route["area"],
                })
            except ReviewError as error:
                blocked.append({"case_id": case_id, "state": "evidence_unavailable", "reason": str(error)})
        return {"schema": "instride-pilot-collection-handoff/1", "eligible": ready, "blocked": blocked}
