// Runs a 500+ RPS load test against /check, then verifies:
//   1. Total allowed requests ≤ configured limit × test_duration_seconds
//   2. No double-spending: allowed count never exceeds what the bucket allows
//
// Usage: node scripts/load_test.js [base_url]

import autocannon from 'autocannon';

const BASE  = process.argv[2] || 'http://127.0.0.1:3000';
const ADMIN = process.env.ADMIN_SECRET || 'changeme';

// Setup: configure a client with a known limit 

async function apiPost(url, body, headers = {}) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify(body),
  });
  return res.json();
}

const CLIENT_KEY    = 'loadtest:client1';
const LIMIT_PER_SEC = 200;// allow 200 rps
const BURST         = 200;
const DURATION_SEC  = 10;

console.log('=== Rate Limiter Load Test ===\n');
console.log(`Target:    ${BASE}`);
console.log(`Client:    ${CLIENT_KEY}`);
console.log(`Algorithm: token_bucket  (${LIMIT_PER_SEC} rps, burst ${BURST})`);
console.log(`Duration:  ${DURATION_SEC}s`);
console.log(`Target RPS: 500+\n`);

// 1. Register client
await apiPost(`${BASE}/admin/clients`,
  { client_key: CLIENT_KEY, algorithm: 'token_bucket', capacity: BURST, refill_rate: LIMIT_PER_SEC },
  { 'x-admin-secret': ADMIN }
);
console.log('Client configured ✓\n');

// 2. Run load test
const result = await new Promise((resolve, reject) => {
  const instance = autocannon({
    url:         `${BASE}/check`,
    method:      'POST',
    headers:     { 'content-type': 'application/json' },
    body:        JSON.stringify({ client_key: CLIENT_KEY }),
    connections: 50,              // 50 concurrent connections
    duration:    DURATION_SEC,
    pipelining:  1,
  }, (err, res) => err ? reject(err) : resolve(res));

  autocannon.track(instance, { renderProgressBar: true });
});

// 3. Analyse
const totalReqs    = result.requests.total;
const rps          = result.requests.average;
const status2xx    = result['2xx'];
const status429    = result.non2xx;          // 429s land here

// Theoretical max allowed over the test window
// First BURST are allowed immediately, then LIMIT_PER_SEC per second after
const theoreticalMax = BURST + LIMIT_PER_SEC * (DURATION_SEC - 1);

console.log('\n=== Results ===');
console.log(`Total requests:      ${totalReqs.toLocaleString()}`);
console.log(`Avg RPS:             ${rps.toFixed(0)}`);
console.log(`ALLOWed (2xx):       ${status2xx.toLocaleString()}`);
console.log(`DENYed  (429):       ${status429.toLocaleString()}`);
console.log(`Theoretical max:     ~${theoreticalMax}`);
console.log(`Latency p99:         ${result.latency.p99}ms`);

const overSpent = status2xx > theoreticalMax + 5;   // +5 for clock skew margin

console.log('\n=== Correctness Check ===');
if (rps < 500) {
  console.warn(`RPS (${rps.toFixed(0)}) < 500 — try increasing connections or check Redis latency`);
} else {
  console.log(`RPS target met: ${rps.toFixed(0)} req/s`);
}

if (overSpent) {
  console.error(`DOUBLE-SPEND DETECTED: allowed ${status2xx} > max ${theoreticalMax}`);
  process.exit(1);
} else {
  console.log(`No double-spending: allowed ${status2xx} ≤ theoretical max ~${theoreticalMax}`);
}

if (status429 === 0) {
  console.warn('Zero 429s — RPS may be too low to trigger limiting');
} else {
  console.log(`Rate limiting is active: ${status429.toLocaleString()} requests denied`);
}

console.log('\nLoad test complete\n');