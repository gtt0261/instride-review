"""Verify the review gate against a small, isolated evidence revision."""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from mobile_bench.review import ReviewError, ReviewStore, inspect_sources
from mobile_bench.review_server import byte_range, public_file


class ReviewGateTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.site = self.root / "site"
        self.media = self.site / "run"
        self.media.mkdir(parents=True)
        (self.media / "preview").mkdir()
        self.entry = {
            "id": "airport", "scene_id": "fixture-scene", "assets": "run/",
            "route_id": "pilot-route", "scene_sha256": "fixture", "instruction": "Face the slot.",
            "target_part": "Orange slot", "draft_approach_xyxy": [-1, 1, 1, 2],
        }
        self.route = {
            "id": self.entry["route_id"], "scene_sha256": self.entry["scene_sha256"],
            "instruction": self.entry["instruction"], "target_part": self.entry["target_part"],
            "area": self.entry["draft_approach_xyxy"], "frames": [[0, 0, 1, 90], [1, 0, 1, 90]],
        }
        self.write(self.media / "audit.json", {"keys": {"start": 0, "turn": 0, "approach": 1, "stop": 1}})
        self.write(self.media / "run.json", {})
        names = ["expert.mp4", "expert-540p.mp4"]
        for view in ("start", "turn", "approach", "stop", "reverse"):
            names.extend((f"{view}.jpg", f"preview/{view}.webp"))
        for name in names:
            (self.media / name).write_bytes(f"fixture {name}".encode())
        self.store = ReviewStore(self.site, self.root / "reviews")
        self.refresh_index()

    def write(self, path, data):
        path.write_text(json.dumps(data), encoding="utf-8")

    def refresh_index(self):
        self.write(self.site / "evaluation-candidates.json", {"cases": [self.entry]})
        self.write(self.media / "trajectory.json", self.route)
        source, _ = inspect_sources(self.site, self.entry)
        self.write(self.site / "review-media.json", {"cases": {"airport": source}})
        self.revision = source["source_revision"]

    def payload(self, **patch):
        return {
            "review_id": str(uuid4()), "source_revision": self.revision, "reviewer_id": "Fixture",
            "decision": "approve", "reason": "", "checks": {"target": True, "approach": True},
            "proposed_area_xyxy_u": self.route["area"], "proposed_no_stop_zones_xyxy_u": [],
            "evidence_locator": {"view": "stop", "frame_index": 1}, **patch,
        }

    def test_joint_approval_and_idempotence(self):
        self.assertEqual(self.store.eligible(["airport"])["blocked"][0]["state"], "pending")
        with self.assertRaisesRegex(ReviewError, "Confirm the target"):
            self.store.submit("airport", self.payload(checks={"target": True, "approach": False}))
        payload = self.payload()
        with ThreadPoolExecutor(4) as pool:
            submitted = list(pool.map(lambda _: self.store.submit("airport", payload), range(8)))
        self.assertTrue(all(row == submitted[0] for row in submitted))
        self.assertEqual(len(self.store.history("airport")), 1)
        self.assertEqual(self.store.eligible(["airport"])["eligible"][0]["review_id"], payload["review_id"])
        with self.assertRaisesRegex(ReviewError, "different submission"):
            self.store.submit("airport", {**payload, "reason": "Different submission"})

    def test_correction_and_revised_source(self):
        saved = self.payload()
        self.store.submit("airport", saved)
        with self.assertRaisesRegex(ReviewError, "proposed geometry"):
            self.store.submit("airport", self.payload(proposed_area_xyxy_u=[0, 0, 1, 2]))
        with self.assertRaisesRegex(ReviewError, "Explain"):
            self.store.submit("airport", self.payload(decision="request_changes"))
        self.store.submit("airport", self.payload(decision="request_changes", reason="Check the public side."))
        self.assertFalse(self.store.eligible(["airport"])["eligible"])

        self.route = {**self.route, "area": [0, 0, 1, 2]}
        self.entry["draft_approach_xyxy"] = self.route["area"]
        self.refresh_index()
        self.assertEqual(self.store.status("airport")["state"], "pending")
        self.assertEqual(len(self.store.status("airport")["history"]), 2)
        self.assertEqual(self.store.submit("airport", saved)["review_id"], saved["review_id"])
        with self.assertRaisesRegex(ReviewError, "revision changed"):
            self.store.submit("airport", self.payload(source_revision=saved["source_revision"]))
        self.assertFalse(self.store.eligible(["airport"])["eligible"])
        self.assertEqual(self.store.submit("airport", self.payload())["source_revision"], self.revision)

    def test_changed_or_missing_evidence_blocks_collection(self):
        self.store.submit("airport", self.payload())
        source = self.media / "preview/stop.webp"
        source.write_bytes(b"changed stop frame")
        self.assertEqual(self.store.eligible(["airport"])["blocked"][0]["state"], "evidence_unavailable")
        source.unlink()
        self.assertEqual(self.store.eligible(["airport"])["blocked"][0]["state"], "evidence_unavailable")

    def test_hazards_and_bad_geometry(self):
        self.route["hazards"] = [{"rect": [0, 1, 5, 3]}]
        self.refresh_index()
        with self.assertRaisesRegex(ReviewError, "overlaps"):
            self.store.submit("airport", self.payload())
        with self.assertRaisesRegex(ReviewError, "valid sides"):
            self.store.submit("airport", self.payload(decision="request_changes", reason="Area",
                                                      proposed_area_xyxy_u=[0, 0, float("nan"), 2]))
        with self.assertRaisesRegex(ReviewError, "valid evidence frame"):
            self.store.submit("airport", self.payload(evidence_locator={"view": "stop", "frame_index": 0}))

    def test_video_ranges_and_read_scope(self):
        self.assertEqual(byte_range("bytes=10-19", 100), (10, 19))
        self.assertEqual(byte_range("bytes=-5", 100), (95, 99))
        self.assertEqual(byte_range("bytes=99-", 100), (99, 99))
        self.assertIsNone(byte_range("bytes=100-", 100))
        self.assertIsNone(byte_range("bytes=0-1,4-9", 100))
        self.assertEqual(public_file(self.site, "/run/expert.mp4"), self.media / "expert.mp4")
        self.assertIsNone(public_file(self.site, "/reviews/airport/decisions.jsonl"))


if __name__ == "__main__":
    unittest.main()
