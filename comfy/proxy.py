#!/usr/bin/env python3
"""Tiny token-checking reverse proxy placed in front of ComfyUI before it is
exposed through a public tunnel. Every request must carry
`x-freegen-token: <TOKEN>` (or `?token=` for /view links), otherwise 401.

Usage: python proxy.py --upstream http://127.0.0.1:8188 --port 8189 --token SECRET
Stdlib only, so it runs on Kaggle/Colab/Modal without extra installs.
"""
import argparse
import http.server
import socketserver
import urllib.request
import urllib.error
import urllib.parse

ARGS = None
HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "content-length"}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _authorized(self):
        if not ARGS.token:
            return True
        if self.headers.get("x-freegen-token") == ARGS.token:
            return True
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return q.get("token", [None])[0] == ARGS.token

    def _proxy(self):
        if not self._authorized():
            body = b'{"error":"freegen token required"}'
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        data = self._read_body()
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP and k.lower() != "x-freegen-token"}
        req = urllib.request.Request(ARGS.upstream + self.path, data=data, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req, timeout=ARGS.timeout) as resp:
                self._relay(resp.status, resp.headers, resp.read())
        except urllib.error.HTTPError as e:
            self._relay(e.code, e.headers, e.read())
        except Exception as e:  # upstream down
            body = ('{"error":"upstream: %s"}' % str(e).replace('"', "'")).encode()
            self._relay(502, {"Content-Type": "application/json"}, body)

    def _read_body(self):
        if "chunked" in (self.headers.get("transfer-encoding") or "").lower():
            chunks = []
            while True:
                size_line = self.rfile.readline().split(b";")[0].strip()
                size = int(size_line or b"0", 16)
                if size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                        pass  # trailers
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.read(2)  # CRLF after each chunk
            return b"".join(chunks)
        length = int(self.headers.get("content-length") or 0)
        return self.rfile.read(length) if length else None

    def _relay(self, status, headers, body):
        self.send_response(status)
        for k, v in headers.items():
            if k.lower() in HOP:
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _proxy

    def log_message(self, fmt, *args):  # quieter logs
        if ARGS.verbose:
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--upstream", default="http://127.0.0.1:8188")
    ap.add_argument("--port", type=int, default=8189)
    ap.add_argument("--token", default="")
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--verbose", action="store_true")
    ARGS = ap.parse_args()
    print(f"[freegen-proxy] {ARGS.upstream} -> 0.0.0.0:{ARGS.port} token={'yes' if ARGS.token else 'NO (open!)'}", flush=True)
    Server(("0.0.0.0", ARGS.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
