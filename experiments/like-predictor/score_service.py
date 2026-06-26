"""Zero-dependency HTTP scoring service (stdlib only).

Keeps the model warm in memory so the voice-writer's best-of-N loop pays the
~1-2s load cost once, not per call.

    POST /score   {"text": "...", "author": "ai.lanrenbao"}        -> single
    POST /score   {"texts": ["...", "..."], "author": "..."}        -> batch
    GET  /health                                                    -> {"ok": true}

Run:  python3 score_service.py [--port 8765]
"""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scorer

DEFAULT_PORT = 8765


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._send(200, {"ok": True, "model": "like-predictor-v1"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/score":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            self._send(400, {"error": f"bad json: {e}"})
            return
        author = data.get("author")
        try:
            if "texts" in data:
                results = scorer.score_many(list(data["texts"]), author)
                self._send(200, {"results": results})
            elif "text" in data:
                self._send(200, scorer.score_one(str(data["text"]), author))
            else:
                self._send(400, {"error": "provide 'text' or 'texts'"})
        except Exception as e:
            self._send(500, {"error": str(e)})

    def log_message(self, *args):  # quiet
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args()
    scorer._bundle()  # warm load before accepting traffic
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f">> like-predictor scoring service on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
