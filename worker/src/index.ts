/**
 * Worker entry point for the zero-AI answer API.
 *
 * Routes:
 *   GET  /api/ask?q=...&lang=en|fa
 *   POST /api/ask  { "q": "...", "lang": "en" }
 *   GET  /api/health
 *
 * Everything on this path is deterministic. There is no AI provider call and
 * no quota that can turn the product off.
 */

import { ask, type AskResponse } from './ask.ts'
import type { D1Database } from './retrieve.ts'

export interface Env {
  DB: D1Database
  /** Exact Pages origin, e.g. https://faater.pages.dev. Defaults to '*'. */
  ALLOWED_ORIGIN?: string
  /** When set, a Turnstile token is required on /api/ask. */
  TURNSTILE_SECRET?: string
  /** Public Turnstile site key, served to the frontend by /api/config. */
  TURNSTILE_SITE_KEY?: string
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extra,
    },
  })

const cors = (request: Request, env: Env): Record<string, string> => {
  const allowed = env.ALLOWED_ORIGIN ?? '*'
  const origin = request.headers.get('origin')
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, cf-turnstile-response',
    'access-control-max-age': '86400',
  }
  // Omit the header entirely for a disallowed origin. "null" is a valid CORS
  // value that opaque origins match, which would turn the allowlist off.
  if (allowed === '*') headers['access-control-allow-origin'] = '*'
  else {
    headers['vary'] = 'Origin'
    if (origin === allowed) headers['access-control-allow-origin'] = allowed
  }
  return headers
}

type TurnstileOutcome = 'ok' | 'invalid' | 'unavailable'

const verifyTurnstile = async (
  token: string,
  secret: string,
  ip: string | null,
): Promise<TurnstileOutcome> => {
  try {
    const form = new FormData()
    form.append('secret', secret)
    form.append('response', token)
    if (ip) form.append('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    })
    // A 5xx is an outage, not a bad token: reserving 403 for bad tokens keeps
    // the client's retry behaviour honest.
    if (!res.ok) return res.status >= 500 ? 'unavailable' : 'invalid'
    const body = (await res.json()) as { success?: boolean }
    return body.success === true ? 'ok' : 'invalid'
  } catch {
    return 'unavailable'
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const headers = cors(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'faater-ask' }, 200, headers)
    }

    if (url.pathname === '/api/config') {
      // The site key is public by design; the secret never leaves the Worker.
      return json(
        { turnstile_site_key: env.TURNSTILE_SITE_KEY ?? null },
        200,
        headers,
      )
    }

    if (url.pathname !== '/api/ask') {
      return json({ error: 'not_found' }, 404, headers)
    }

    let q = ''
    let lang: 'en' | 'fa' | undefined
    let turnstile = request.headers.get('cf-turnstile-response') ?? ''

    if (request.method === 'GET') {
      q = url.searchParams.get('q') ?? ''
      const l = url.searchParams.get('lang')
      if (l === 'en' || l === 'fa') lang = l
    } else if (request.method === 'POST') {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return json({ error: 'invalid_json' }, 400, headers)
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return json({ error: 'invalid_json' }, 400, headers)
      }
      const fields = body as { q?: unknown; lang?: unknown; token?: unknown }
      q = typeof fields.q === 'string' ? fields.q : ''
      if (fields.lang === 'en' || fields.lang === 'fa') lang = fields.lang
      if (typeof fields.token === 'string') turnstile = fields.token
    } else {
      return json({ error: 'method_not_allowed' }, 405, headers)
    }

    if (env.TURNSTILE_SECRET) {
      const ip = request.headers.get('cf-connecting-ip')
      const outcome = turnstile
        ? await verifyTurnstile(turnstile, env.TURNSTILE_SECRET, ip)
        : 'invalid'
      if (outcome === 'unavailable') {
        return json({ error: 'turnstile_unavailable' }, 503, headers)
      }
      if (outcome !== 'ok') return json({ error: 'turnstile_failed' }, 403, headers)
    }

    try {
      const response: AskResponse = await ask(env.DB, { q, lang }, crypto.randomUUID())
      // Answers are deterministic for a given q+lang+index; let the edge cache
      // them only when the URL is cacheable (GET). POST is never cached.
      const cacheable = request.method === 'GET'
      return json(
        response,
        200,
        cacheable ? { ...headers, 'cache-control': 'public, max-age=300' } : headers,
      )
    } catch {
      return json({ error: 'internal' }, 500, headers)
    }
  },
}