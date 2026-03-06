/* global __ENV, __VU */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '40s', target: 50 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:30080';

function uuid() {
  return `${Date.now()}-${Math.random()}`;
}

export default function () {
  const u = `u_${__VU}`;
  const merchant = 'm_1';
  const amount = 100;

  const createKey = `k6-create-${uuid()}`;
  const createRes = http.post(
    `${BASE}/orders`,
    JSON.stringify({ userId: u, merchantId: merchant, amount, currency: 'SGD' }),
    { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createKey, 'X-User-Id': u } },
  );

  const createOk = check(createRes, {
    'create status 201/200': (r) => r.status === 201 || r.status === 200,
  });
  if (!createOk) {
    sleep(0.1);
    return;
  }

  let body;
  try {
    body = createRes.json();
  } catch {
    sleep(0.1);
    return;
  }
  const orderId = body?.data?.id;
  if (!orderId) {
    sleep(0.1);
    return;
  }

  const confirmKey = `k6-confirm-${uuid()}`;
  const confirmRes = http.post(`${BASE}/orders/${orderId}/confirm`, null, {
    headers: { 'Idempotency-Key': confirmKey, 'X-User-Id': u },
  });

  check(confirmRes, {
    'confirm status 201/200': (r) => r.status === 201 || r.status === 200,
  });

  sleep(0.1);
}
