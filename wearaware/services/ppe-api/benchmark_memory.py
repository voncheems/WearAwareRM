"""Local, real-model memory check using synthetic images, never production data.

Run in a fresh process: python services/ppe-api/benchmark_memory.py --requests 20
Peak RSS is platform-dependent and is not a detection-accuracy measurement.
"""
import argparse
import asyncio
import io
import json
import os
import resource
import sys
import time


def report(stage, **details):
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    divisor = 1024 * 1024 if sys.platform == 'darwin' else 1024
    print(json.dumps({'stage': stage, 'peak_rss_mib': round(usage / divisor, 2), **details}), flush=True)


async def benchmark(args):
    # Set before importing api so the benchmark never reads a real API key.
    os.environ['AI_API_KEY'] = 'isolated-local-memory-benchmark-key-32-characters'
    report('python', platform=sys.platform)
    import api
    from PIL import Image
    from starlette.datastructures import Headers, UploadFile
    report('imports')
    api.load_model()
    report('model_loaded')
    for index in range(args.requests):
        # Includes JPEG validation, full-size decoding, resize, inference and
        # optional annotation encoding. Does not simulate Uvicorn/network RSS.
        content = io.BytesIO()
        with Image.new('RGB', (args.width, args.height), color=(96, 96, 96)) as image:
            image.save(content, format='JPEG')
        content.seek(0)
        upload = UploadFile(content, filename='synthetic.jpg', headers=Headers({'content-type': 'image/jpeg'}))
        started = time.monotonic()
        try:
            response = await api.detect(file=upload, conf=.35, iou=.5, return_image=args.annotated, required_ppe='helmet,vest')
            report('request', sequence=index + 1, status=response.status_code,
                   elapsed_ms=round((time.monotonic() - started) * 1000, 1))
            del response
        finally:
            await upload.close()
    report('complete', requests=args.requests, annotated=args.annotated,
           width=args.width, height=args.height)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--requests', type=int, default=20)
    parser.add_argument('--width', type=int, default=1280)
    parser.add_argument('--height', type=int, default=720)
    parser.add_argument('--annotated', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.requests <= 1000 or min(args.width, args.height) < 1 or args.width * args.height > 4_000_000:
        parser.error('Use 1–1000 requests and positive dimensions up to 4 million pixels.')
    asyncio.run(benchmark(args))
