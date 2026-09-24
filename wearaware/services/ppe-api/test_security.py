"""Run with the inference environment: python -m unittest discover -s services/ppe-api -p 'test_*.py'.
ASGI tests use a fake predictor: no external service, worker data, or model accuracy claims.
"""
import os
os.environ['AI_API_KEY'] = 'isolated-ai-security-test-secret-32-characters'
import asyncio
import io
import json
import unittest
from PIL import Image
import api

class FakeModel:
    names = {0: 'helmet'}

async def request(path, body=b'', headers=None, method='GET'):
    sent = []
    delivered = False
    finished = asyncio.Event()
    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {'type': 'http.request', 'body': body, 'more_body': False}
        await finished.wait()
        return {'type': 'http.disconnect'}
    async def send(message):
        sent.append(message)
        if message['type'] == 'http.response.body' and not message.get('more_body', False): finished.set()
    pathname, _, query = path.partition('?')
    scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.0'}, 'http_version': '1.1', 'scheme': 'http', 'method': method, 'path': pathname, 'raw_path': pathname.encode(), 'query_string': query.encode(), 'root_path': '', 'headers': [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()], 'client': ('127.0.0.1', 12345), 'server': ('127.0.0.1', 8000)}
    await api.app(scope, receive, send)
    status = next(x['status'] for x in sent if x['type'] == 'http.response.start')
    data = b''.join(x.get('body', b'') for x in sent if x['type'] == 'http.response.body')
    return status, json.loads(data)

def multipart(content):
    body = b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="frame.png"\r\nContent-Type: image/png\r\n\r\n' + content + b'\r\n--boundary--\r\n'
    return body, {'X-API-Key': os.environ['AI_API_KEY'], 'Content-Type': 'multipart/form-data; boundary=boundary', 'Content-Length': str(len(body))}

class SecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_key_required_and_health_readiness(self):
        self.assertEqual((await request('/health'))[0], 401)
        api.model = None
        self.assertEqual((await request('/health', headers={'X-API-Key': os.environ['AI_API_KEY']}))[0], 503)
        api.model = FakeModel()
        self.assertEqual((await request('/health', headers={'X-API-Key': os.environ['AI_API_KEY']}))[0], 200)

    async def test_upload_limits_and_invalid_images(self):
        api.model = FakeModel()
        headers = {'X-API-Key': os.environ['AI_API_KEY'], 'Content-Length': str(api.MAX_UPLOAD + 20000)}
        self.assertEqual((await request('/detect', headers=headers, method='POST'))[0], 413)
        body, headers = multipart(b'not-an-image')
        self.assertEqual((await request('/detect', body, headers, 'POST'))[0], 400)

    async def test_confidence_contract_and_safe_errors(self):
        api.model = FakeModel()
        out = io.BytesIO(); Image.new('RGB', (16, 16)).save(out, format='PNG')
        body, headers = multipart(out.getvalue())
        captured = []
        def detect(frame, conf, iou):
            captured.append(conf)
            return frame, [], [], []
        original = api.run_detection
        api.run_detection = detect
        try:
            status, payload = await request('/detect?conf=0.35', body, headers, 'POST')
            self.assertEqual(status, 200); self.assertEqual(captured, [0.35]); self.assertEqual(payload['total_detections'], 0)
            self.assertEqual((await request('/detect?conf=2', body, headers, 'POST'))[0], 400)
            def broken(*args): raise RuntimeError('private-path-and-secret')
            api.run_detection = broken
            status, payload = await request('/detect', body, headers, 'POST')
            self.assertEqual(status, 500); self.assertNotIn('private-path', str(payload))
        finally: api.run_detection = original

if __name__ == '__main__': unittest.main()
