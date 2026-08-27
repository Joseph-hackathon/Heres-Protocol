import test from 'node:test'
import assert from 'node:assert/strict'

interface MockRequest {
  headers: {
    get(key: string): string | null
  }
  nextUrl: {
    searchParams: URLSearchParams
  }
}

function createMockRequest(url: string, headers: Record<string, string> = {}): MockRequest {
  const parsed = new URL(url, 'http://localhost')
  const headerMap = new Map<string, string>()
  Object.entries(headers).forEach(([k, v]) => headerMap.set(k.toLowerCase(), v))
  return {
    headers: {
      get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
    },
    nextUrl: {
      searchParams: parsed.searchParams,
    },
  }
}

function isAuthorized(request: MockRequest, secret: string): boolean {
  const auth = request.headers.get('authorization')
  if (auth === 'Bearer ' + secret) return true
  const querySecret = request.nextUrl.searchParams.get('secret') ?? request.nextUrl.searchParams.get('key')
  if (querySecret === secret) return true
  const customHeader = request.headers.get('x-cron-secret') ?? request.headers.get('x-cron-key')
  if (customHeader === secret) return true
  return false
}

test('authorization: accepts Bearer token in Authorization header', () => {
  const secret = 'my-secret-123'
  const req = createMockRequest('http://localhost/api/cron/execute-intent', {
    authorization: 'Bearer my-secret-123',
  })
  assert.equal(isAuthorized(req, secret), true)
})

test('authorization: accepts ?secret=... query parameter (cron-job.org default)', () => {
  const secret = 'd463e6389e5c6c4cbe66b7b7bf7a4ae'
  const req = createMockRequest(
    'http://localhost/api/cron/execute-intent?secret=d463e6389e5c6c4cbe66b7b7bf7a4ae'
  )
  assert.equal(isAuthorized(req, secret), true)
})

test('authorization: accepts ?key=... query parameter', () => {
  const secret = 'd463e6389e5c6c4cbe66b7b7bf7a4ae'
  const req = createMockRequest(
    'http://localhost/api/cron/undelegate-capsules?key=d463e6389e5c6c4cbe66b7b7bf7a4ae'
  )
  assert.equal(isAuthorized(req, secret), true)
})

test('authorization: rejects invalid or missing secrets', () => {
  const secret = 'super-secret'
  const reqMissing = createMockRequest('http://localhost/api/cron/execute-intent')
  assert.equal(isAuthorized(reqMissing, secret), false)

  const reqWrong = createMockRequest(
    'http://localhost/api/cron/execute-intent?secret=wrong-secret'
  )
  assert.equal(isAuthorized(reqWrong, secret), false)
})
