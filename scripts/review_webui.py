"""Serve the internal review UI on loopback or check pilot collection eligibility."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from mobile_bench.review import ReviewError, ReviewStore, load_catalog
from mobile_bench.review_server import serve


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=ROOT)
    parser.add_argument("--reviews", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    server = commands.add_parser("serve")
    server.add_argument("--port", type=int, default=8790)
    eligible = commands.add_parser("eligible")
    eligible.add_argument("--case")
    args = parser.parse_args()

    store = ReviewStore(args.site, args.reviews)
    catalog = load_catalog(store.site)
    if args.command == "serve":
        serve(store, args.port)
        return 0

    report = store.eligible([args.case] if args.case else list(catalog))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if args.case and not report["eligible"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ReviewError as error:
        sys.exit(str(error))
