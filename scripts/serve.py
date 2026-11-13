#!/usr/bin/env python3
"""Local web server for Anything Kart.

Browsers only give a page camera access when it comes from http://localhost,
so the game needs a tiny server. Python's built-in one can fail on macOS with
"No buffer space available" when several big files (the object-detector model)
download at once, so this one sends files in chunks and retries.

    python3 scripts/serve.py        # serves on the first free port from 8000
    python3 scripts/serve.py 8765   # or a specific port
    npm start                       # the same, via package.json
"""
import errno
import http.server
import os
import socket
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the project folder (this file is in scripts/)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def copyfile(self, source, outputfile):
        sock = self.connection
        while True:
            chunk = source.read(256 * 1024)
            if not chunk:
                return
            view = memoryview(chunk)
            while view:
                try:
                    sent = sock.send(view)
                    view = view[sent:]
                except OSError as e:
                    if e.errno in (errno.ENOBUFS, errno.EAGAIN, errno.EWOULDBLOCK):
                        time.sleep(0.005)
                        continue
                    raise

    def log_message(self, fmt, *args):
        pass


def free_port(start):
    for port in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("No free port found")


def main():
    fixed = len(sys.argv) > 1
    port = int(sys.argv[1]) if fixed else free_port(8000)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://localhost:{port}"
    print(f"🏁 Anything Kart is running at {url}")
    print("   Keep this window open while you play. Press Ctrl+C to stop.")
    if not fixed:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye! 👋")


if __name__ == "__main__":
    main()
