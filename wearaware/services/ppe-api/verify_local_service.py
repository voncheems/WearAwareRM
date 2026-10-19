"""Check a disposable localhost Uvicorn process with real weights and synthetic JPEGs.

python services/ppe-api/verify_local_service.py --requests 20
Never connects to production or Atlas. No URL/credential arguments are accepted.
RSS is sampled for this one child process, not a container memory guarantee.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import io
import json
import math
import os
from pathlib import Path
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


def main(count):
    from PIL import Image
    key = 'isolated-local-http-verification-key-32-characters'
    directory = Path(__file__).resolve().parent
    records, rss = [], []
    stopped = threading.Event()
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    listener.listen(128)
    origin = f'http://127.0.0.1:{listener.getsockname()[1]}'
    environment = {**os.environ, 'AI_API_KEY': key, 'YOLO_AUTOINSTALL': 'false'}

    def jpeg(width=1280, height=720):
        buffer = io.BytesIO()
        with Image.new('RGB', (width, height), color=(96, 96, 96)) as image:
            image.save(buffer, format='JPEG')
        return buffer.getvalue()

    with tempfile.TemporaryFile() as logs:
        child = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'api:app', '--app-dir', str(directory),
                                  '--fd', str(listener.fileno()), '--workers', '1', '--no-access-log',
                                  '--log-level', 'error'], env=environment, pass_fds=(listener.fileno(),),
                                 stdout=logs, stderr=logs)
        listener.close()

        def sample():
            while not stopped.is_set():
                try:
                    # Linux reports process high-water RSS; macOS uses sampled RSS.
                    status = Path(f'/proc/{child.pid}/status')
                    if status.exists():
                        value = next(line.split()[1] for line in status.read_text().splitlines() if line.startswith('VmHWM:'))
                    else:
                        value = subprocess.check_output(['ps', '-o', 'rss=', '-p', str(child.pid)], stderr=subprocess.DEVNULL, text=True).strip()
                    if value: rss.append(int(value) / 1024)
                except (OSError, ValueError, StopIteration, subprocess.CalledProcessError):
                    pass
                stopped.wait(.1)

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()

        def request(case, image=None, timeout=35, authenticated=True):
            headers = {'X-API-Key': key} if authenticated else {}
            path = '/healthz' if image is None else '/detect?conf=0.35&return_image=false&required_ppe=helmet,vest'
            body = None
            if image is not None:
                body = (b'--frame\r\nContent-Disposition: form-data; name="file"; filename="synthetic.jpg"\r\n'
                        b'Content-Type: image/jpeg\r\n\r\n' + image + b'\r\n--frame--\r\n')
                headers['Content-Type'] = 'multipart/form-data; boundary=frame'
            started = time.monotonic()
            row = {'case': case}
            try:
                with urllib.request.urlopen(urllib.request.Request(origin + path, data=body, headers=headers), timeout=timeout) as response:
                    payload = json.load(response)
                    row.update(status=response.status)
                    if image is not None:
                        row.update(person_count=payload.get('person_count'), total_detections=payload.get('total_detections'),
                                   inference_time_ms=payload.get('inference_time_ms'))
            except urllib.error.HTTPError as error:
                error.close()
                row['status'] = error.code
            except (TimeoutError, urllib.error.URLError, OSError) as error:
                row['error_category'] = type(error).__name__
            row['elapsed_ms'] = round((time.monotonic() - started) * 1000, 2)
            return row

        try:
            startup = time.monotonic()
            deadline = startup + 90
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    raise RuntimeError('Local AI process exited during startup; inspect dependencies and weights privately.')
                ready = request('readiness', timeout=.5)
                if ready.get('status') == 200: break
                time.sleep(.2)
            else:
                raise RuntimeError('Local AI startup exceeded 90 seconds.')
            startup_ms = round((time.monotonic() - startup) * 1000, 2)
            image = jpeg()
            # A two-request cold burst tests real overload without unbounded load.
            with ThreadPoolExecutor(max_workers=2) as pool:
                records.extend(pool.map(lambda _: request('concurrent_cold', image), range(2)))
            records.append(request('single', image))
            records.extend(request('sequential', image) for _ in range(count))
            records.append(request('large_resize', jpeg(2000, 2000)))
            records.append(request('pixel_limit', jpeg(2001, 2000)))
            records.append(request('byte_limit', b'x' * (2 * 1024 * 1024 + 1)))
            records.append(request('invalid_image', b'not-an-image'))
            records.append(request('unauthenticated', image, authenticated=False))
            # Deliberate client timeout: no restart/kill or artificial inference delay.
            records.append(request('short_client_timeout', image, timeout=.000001))
            time.sleep(.5)
            records.append(request('recovery', image))
            records.append(request('final_readiness'))
            expected = {'single': {200}, 'sequential': {200}, 'concurrent_cold': {200, 503},
                        'large_resize': {200}, 'pixel_limit': {400}, 'byte_limit': {413},
                        'invalid_image': {400}, 'unauthenticated': {401}, 'recovery': {200}, 'final_readiness': {200}}
            failures = [row['case'] for row in records if row['case'] in expected and row.get('status') not in expected[row['case']]]
            latency = sorted(row['elapsed_ms'] for row in records if row['case'] == 'sequential' and row.get('status') == 200)
            result = {'scope': 'localhost synthetic JPEGs; real model; one Uvicorn worker',
                      'startup_to_ready_ms': startup_ms, 'sampled_process_rss_peak_mib': round(max(rss), 2) if rss else None,
                      'rss_sampling_interval_ms': 100, 'unexpected_failures': len(failures),
                      'expected_overload_503_count': sum(row.get('status') == 503 for row in records if row['case'] == 'concurrent_cold'),
                      'sequential_latency_ms': {'median': round(statistics.median(latency), 2),
                                                'p95': latency[max(0, math.ceil(len(latency) * .95) - 1)]} if latency else None,
                      'records': records}
            print(json.dumps(result, indent=2))
            return bool(failures)
        finally:
            stopped.set()
            child.terminate()
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            sampler.join(timeout=1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--requests', type=int, default=20)
    args = parser.parse_args()
    if not 1 <= args.requests <= 100:
        parser.error('Use 1–100 sequential requests.')
    sys.exit(main(args.requests))
