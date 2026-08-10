#!/usr/bin/env python3
"""多线程分段下载，支持断点续传。"""
import sys, os, time, threading
from urllib.request import Request, urlopen

URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"
OUT = sys.argv[1] if len(sys.argv) > 1 else "public/wiktionary-en.jsonl"
THREADS = 4

def get_size():
    req = Request(URL, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
    return int(urlopen(req, timeout=15).headers['Content-Length'])

def download_segment(start, end, idx):
    part_file = f"{OUT}.part{idx}"
    existing = os.path.getsize(part_file) if os.path.exists(part_file) else 0

    if existing > 0 and existing < (end - start):
        # Resume
        current_start = start + existing
    else:
        current_start = start
        with open(part_file, 'wb') as f:
            f.truncate(0)

    if current_start >= end:
        return end - start

    req = Request(URL, headers={
        'User-Agent': 'Mozilla/5.0',
        'Range': f'bytes={current_start}-{end-1}',
    })
    resp = urlopen(req, timeout=60)

    with open(part_file, 'ab') as f:
        while True:
            chunk = resp.read(256 * 1024)
            if not chunk: break
            f.write(chunk)

    return os.path.getsize(part_file)

class Progress:
    def __init__(self, total):
        self.done = [0] * THREADS
        self.total = total
        self.running = True
    def update(self, idx, size):
        self.done[idx] = size
    def stop(self):
        self.running = False
    def report(self):
        while self.running:
            done = sum(self.done)
            pct = done / self.total * 100 if self.total else 0
            mb = done / 1024 / 1024
            total_mb = self.total / 1024 / 1024
            print(f"\r  进度: {mb:.0f}/{total_mb:.0f}MB ({pct:.1f}%)", end='', flush=True)
            time.sleep(1)

def merge():
    print("\n  合并分片...")
    with open(OUT, 'wb') as out:
        for i in range(THREADS):
            part = f"{OUT}.part{i}"
            with open(part, 'rb') as f:
                out.write(f.read())

def run():
    total = get_size()
    chunk = total // THREADS
    prog = Progress(total)

    reporter = threading.Thread(target=prog.report, daemon=True)
    reporter.start()

    threads = []
    for i in range(THREADS):
        start = i * chunk
        end = (i + 1) * chunk if i < THREADS - 1 else total
        t = threading.Thread(target=lambda s=start, e=end, idx=i: prog.update(idx, download_segment(s, e, idx)))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    prog.stop()
    merge()

    # 清理分片
    for i in range(THREADS):
        part = f"{OUT}.part{i}"
        if os.path.exists(part): os.remove(part)

    final_mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"\r  ✅ 完成! {final_mb:.0f}MB")

if __name__ == '__main__':
    run()
