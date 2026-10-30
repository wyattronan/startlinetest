// Netlify Edge Function: forwards Startline's AI requests to the Anthropic API.
// Your API key stays here on the server and is never sent to the browser.
// Set ANTHROPIC_API_KEY in Netlify: Site configuration > Environment variables, then redeploy.
// Optional: MODEL (default claude-sonnet-5-5), MODEL_QUICK (default claude-haiku-5-5).
//
// GET /api/ai?check=1 runs a tiny live test and reports exactly what's wrong (used by /ai-check.html).

const MAX_INPUT_CHARS = 200000;
const MAX_TOKENS = 8000;
const API = 'https://api.anthropic.com/v1/messages';

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, code, message) => json(status, { code, message });

const env = name => {
  try { return (globalThis.Netlify && Netlify.env.get(name)) || ''; } catch (_) { return ''; }
};
const models = () => ({ main: env('MODEL') || 'claude-sonnet-5-5', quick: env('MODEL_QUICK') || 'claude-haiku-5-5' });

// Turn an Anthropic API error into a code the page understands, plus a plain-English detail.
function explain(status, msg) {
  const m = String(msg || '');
  if (status === 401) return ['bad_key', 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY for typos or extra spaces, then redeploy.'];
  if (status === 403) return ['bad_key', 'The API key doesn’t have permission for this request. ' + m];
  if (/credit balance|billing|purchase credits/i.test(m)) return ['no_credit', 'The Anthropic account is out of credits. Add credits at console.anthropic.com (Plans & Billing).'];
  if (status === 404 || /model/i.test(m) && /not.?found|invalid|does not exist/i.test(m)) return ['bad_model', 'The model name isn’t available to this API key. Set MODEL to a model your account can use. ' + m];
  if (status === 413) return ['prompt_too_large', 'Request too large.'];
  if (status === 429) return ['rate_limited', 'Rate limit reached on the Anthropic account. ' + m];
  if (status === 529 || status === 503) return ['overloaded', 'Anthropic is temporarily overloaded. Try again shortly.'];
  return ['upstream_error', `Anthropic API error ${status}. ${m}`.trim()];
}

function sameSite(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  let oh = '';
  try { oh = new URL(origin).hostname; } catch (_) { return false; }
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).hostname).split(':')[0];
  if (oh === host || oh === 'localhost' || oh === '127.0.0.1') return true;
  if (oh.endsWith('.netlify.app') && host.endsWith('.netlify.app') && oh.split('--').pop() === host.split('--').pop()) return true; // deploy previews
  const extra = env('ALLOWED_ORIGINS').split(',').map(s => s.trim()).filter(Boolean);
  return extra.some(e => { try { return new URL(e).hostname === oh; } catch (_) { return e === oh; } });
}

async function check() {
  const key = env('ANTHROPIC_API_KEY').trim();
  const { main, quick } = models();
  const out = { ok: false, function: true, keySet: !!key, model: main, quickModel: quick };
  if (!key) return json(200, { ...out, code: 'no_key', detail: 'ANTHROPIC_API_KEY isn’t set. Add it under Site configuration → Environment variables, then trigger a new deploy.' });
  for (const [label, model] of [['main', main], ['quick', quick]]) {
    let r;
    try {
      r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK.' }] }) });
    } catch (e) {
      return json(200, { ...out, code: 'upstream_unreachable', detail: 'The function couldn’t reach api.anthropic.com: ' + String(e) });
    }
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).error?.message || ''; } catch (_) {}
      const [code, detail] = explain(r.status, msg);
      return json(200, { ...out, code, detail: `${label === 'quick' ? 'Quick model (' + model + '): ' : ''}${detail}` });
    }
  }
  return json(200, { ...out, ok: true, detail: 'Everything is connected.' });
}

export default async (request) => {
  if (request.method === 'GET') return check();
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.');
  if (!sameSite(request)) return fail(403, 'forbidden', 'This site isn’t allowed to use the AI service. Add its address to ALLOWED_ORIGINS.');

  const key = env('ANTHROPIC_API_KEY').trim();
  if (!key) return fail(500, 'no_key', 'ANTHROPIC_API_KEY isn’t set on the server.');

  let body;
  try { body = await request.json(); } catch (_) { return fail(400, 'bad_request', 'Invalid request.'); }
  const { input, modelTier } = body || {};

  let messages;
  if (typeof input === 'string') messages = [{ role: 'user', content: input }];
  else if (Array.isArray(input)) messages = input
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content }));
  // The API needs turns to start with "user" and alternate, so merge back-to-back turns from the same side.
  if (messages) {
    while (messages.length && messages[0].role !== 'user') messages.shift();
    messages = messages.reduce((acc, m) => {
      const last = acc[acc.length - 1];
      if (last && last.role === m.role) last.content += '\n\n' + m.content; else acc.push({ ...m });
      return acc;
    }, []);
  }
  if (!messages || !messages.length || messages[messages.length - 1].role !== 'user') return fail(400, 'bad_request', 'Input must end on a user turn.');
  if (JSON.stringify(messages).length > MAX_INPUT_CHARS) return fail(413, 'prompt_too_large', 'Input too large.');

  const { main, quick } = models();
  const model = modelTier === 'quick' ? quick : main;

  let upstream;
  try {
    upstream = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, stream: true, messages })
    });
  } catch (e) {
    return fail(502, 'upstream_unreachable', 'Couldn’t reach api.anthropic.com.');
  }

  if (!upstream.ok) {
    let msg = '';
    try { msg = (await upstream.json()).error?.message || ''; } catch (_) {}
    const [code, detail] = explain(upstream.status, msg);
    return fail(upstream.status >= 500 ? 503 : upstream.status === 429 ? 429 : 502, code, detail);
  }

  // Pass the stream straight through so answers appear as they're written.
  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }
  });
};

export const config = { path: '/api/ai' };
