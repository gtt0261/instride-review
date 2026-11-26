"""Loopback HTTP transport for the review journal and byte-range playback."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from .review import CASE_ID, VIEWS, ReviewError, ReviewStore


SITE_FILES = {
    "index.html", "airport.css", "airport.js", "playback.js", "reviews.js", "share.js",
    "evaluation-candidates.json", "review-media.json",
}
CASE_FILES = {"trajectory.json", "audit.json", "run.json", "expert.mp4", "expert-540p.mp4"}
CASE_FILES |= {f"{view}.jpg" for view in VIEWS} | {f"preview/{view}.webp" for view in VIEWS}
LOCAL_HOST = re.compile(r"(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?")


def public_file(site: Path, request_path: str) -> Path | None:
    name = unquote(request_path).removeprefix("/") or "index.html"
    if name not in SITE_FILES:
        if name.startswith("run/"):
            relative = name.removeprefix("run/")
        else:
            path = name.split("/", 2)
            if len(path) != 3 or path[0] != "cases" or not CASE_ID.fullmatch(path[1]):
                return None
            relative = path[2]
        if relative not in CASE_FILES:
            return None
    file = site / name
    return file if file.resolve().is_relative_to(site) and file.is_file() else None


def byte_range(header: str, size: int) -> tuple[int, int] | None:
    match = re.fullmatch(r"bytes=(\d{0,16})-(\d{0,16})", header)
    if not match or not size or not any(match.groups()):
        return None
    start, end = match.groups()
    if not start:
        count = int(end)
        return (max(0, size - count), size - 1) if count else None
    first, last = int(start), min(int(end), size - 1) if end else size - 1
    return (first, last) if first <= last else None


class ReviewHandler(BaseHTTPRequestHandler):
    store: ReviewStore

    def allowed_host(self) -> bool:
        if not LOCAL_HOST.fullmatch(self.headers.get("Host", "")):
            self.send_error(403)
            return False
        return True

    def json_response(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def api(self, api_path: str) -> None:
        case_id = api_path.removeprefix("/api/reviews/")
        if not CASE_ID.fullmatch(case_id):
            self.json_response(404, {"error": "Unknown scene."})
            return
        try:
            if self.command == "POST":
                if (self.headers.get("Origin") != f"http://{self.headers['Host']}"
                        or self.headers.get_content_type() != "application/json"):
                    raise ReviewError("Submit from the internal review page.", 403)
                length = self.headers.get("Content-Length", "")
                if not re.fullmatch(r"[0-9]{1,5}", length) or not 0 < int(length) <= 16_000:
                    raise ReviewError("Invalid review request size.", 413)
                try:
                    payload = json.loads(self.rfile.read(int(length)))
                except (ValueError, UnicodeError) as error:
                    raise ReviewError("Expected a JSON review.") from error
                self.json_response(200, self.store.submit(case_id, payload))
            else:
                self.json_response(200, self.store.status(case_id))
        except ReviewError as error:
            self.json_response(error.status, {"error": str(error)})

    def do_POST(self) -> None:
        if not self.allowed_host():
            return
        path = urlsplit(self.path).path
        if path.startswith("/api/reviews/"):
            self.api(path)
        else:
            self.send_error(404)

    def do_GET(self) -> None:
        try:
            self.get()
        except (BrokenPipeError, ConnectionResetError):
            pass  # A seek or scene switch canceled the old transfer.

    def do_HEAD(self) -> None:
        self.do_GET()

    def get(self) -> None:
        if not self.allowed_host():
            return
        uri = urlsplit(self.path)
        if uri.path.startswith("/api/reviews/"):
            self.api(uri.path)
            return
        path = public_file(self.store.site, uri.path)
        if path is None:
            self.send_error(404)
            return
        if path.name == "index.html":
            content = path.read_bytes().replace(b"<head>", b'<head>\n<meta name="review-mode" content="server">', 1)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)
            return
        with path.open("rb") as file:
            size = os.fstat(file.fileno()).st_size
            request_range = self.headers.get("Range")
            region = byte_range(request_range, size) if request_range else (0, size - 1)
            if region is None:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            first, last = region
            remaining = last - first + 1
            self.send_response(206 if request_range else 200)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(remaining))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, max-age=86400" if uri.query and path.suffix != ".json"
                             else "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            if request_range:
                self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
            self.end_headers()
            if self.command != "HEAD":
                file.seek(first)
                while remaining:
                    chunk = file.read(min(remaining, 256 * 1024))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)


def serve(store: ReviewStore, port: int) -> None:
    class Handler(ReviewHandler):
        pass

    Handler.store = store
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        print(f"Review UI listening on http://127.0.0.1:{server.server_port}/", flush=True)
        server.serve_forever()
