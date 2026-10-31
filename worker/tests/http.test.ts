/**
 * HTTP-layer tests that need no database: CORS must fail closed, and a
 * disallowed Origin must not receive the literal `null` allow-origin value
 * (which opaque origins match).
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../src/index.ts'

const env = { DB: null as never, ALLOWED_ORIGIN: 'https://faater.pages.dev' }

test('a disallowed origin gets no allow-origin header', async () => {
  const res = await worker.fetch(
    new Request('https://api.faater.art/api/health', { headers: { origin: 'https://evil.example' } }),
    env,
  )
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), null)
})

test('an allowed origin is echoed exactly', async () => {
  const res = await worker.fetch(
    new Request('https://api.faater.art/api/health', {
      headers: { origin: 'https://faater.pages.dev' },
    }),
    env,
  )
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://faater.pages.dev')
})

test('preflight from a disallowed origin does not authorise the origin', async () => {
  const res = await worker.fetch(
    new Request('https://api.faater.art/api/ask', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    }),
    env,
  )
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), null)
  assert.equal(res.headers.get('vary'), 'Origin')
})

test('a JSON null body is a 400, not a runtime crash', async () => {
  const res = await worker.fetch(
    new Request('https://api.faater.art/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    }),
    env,
  )
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'invalid_json' })
})

test('the public config endpoint exposes only the Turnstile site key', async () => {
  const res = await worker.fetch(
    new Request('https://api.faater.art/api/config'),
    { ...env, TURNSTILE_SITE_KEY: 'public-site-key', TURNSTILE_SECRET: 'never-expose-this' },
  )
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { turnstile_site_key: 'public-site-key' })
})
