/* Startline on its own site.
   The page was built for claude.ai, where AI, sign-in, cloud saves and downloads
   come from window.claude.use(...). This file provides the same interface on Netlify:
   - "sample"    -> streams from /api/ai (a Netlify Edge Function holding your Anthropic key)
   - "downloads" -> a normal browser download
   - "user", "db" -> not connected yet, so progress saves in the browser (localStorage)
   Every AI feature on the site (scoring, Red Pen, LinkedIn tips, career vision, path,
   weekly plan, interview prep, cold pitches, coach chat) goes through sample() below. */
(function () {
  const ENDPOINT = '/api/ai';
  const RETRYABLE = new Set(['network', 'overloaded', 'upstream_unreachable', 'server_error', 'rate_limited']);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function httpError(status, j, ctype) {
    // A 404/405, or an HTML page instead of the function's JSON, means the AI function isn't deployed.
    if (status === 404 || status === 405 || (!j.code && /html/i.test(ctype || '')))
      return { code: 'not_deployed', detail: 'The AI function isn’t deployed on this site (' + status + ').' };
    return { code: j.code || (status === 429 ? 'rate_limited' : status === 413 ? 'prompt_too_large' : 'server_error'), detail: j.message || ('HTTP ' + status) };
  }

  async function once(input, o) {
    let res, text = '', stop = '';
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, modelTier: o.modelTier || 'default' }),
        signal: o.signal
      });
    } catch (e) {
      throw e && e.name === 'AbortError' ? { code: 'cancelled' } : { code: 'network', detail: 'No connection to the AI service.' };
    }
    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || !/event-stream/i.test(ctype)) {
      let j = {};
      try { j = await res.json(); } catch (_) {}
      throw httpError(res.ok ? 404 : res.status, j, ctype);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch (_) { continue; }
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
            text += ev.delta.text;
            if (o.onText) o.onText({ text, delta: ev.delta.text });
          } else if (ev.type === 'message_delta' && ev.delta) {
            stop = ev.delta.stop_reason || stop;
          } else if (ev.type === 'error') {
            const t = ev.error && ev.error.type;
            throw { code: t === 'overloaded_error' ? 'overloaded' : t === 'rate_limit_error' ? 'rate_limited' : 'server_error', detail: (ev.error && ev.error.message) || '', text };
          }
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw { code: 'cancelled', text };
      throw e && e.code ? e : { code: 'network', detail: 'The connection dropped mid-answer.', text };
    }
    if (stop === 'refusal') throw { code: 'refused', text };
    if (!text.trim()) throw { code: 'empty_completion' };
    return { text, truncated: stop === 'max_tokens' };
  }

  // Retry brief hiccups (dropped connection, overload) up to twice, but never after text has been shown.
  async function sample(input, o = {}) {
    let shown = false;
    const opts = Object.assign({}, o, { onText: o.onText ? (x => { shown = true; o.onText(x); }) : null });
    for (let attempt = 0; ; attempt++) {
      try { return await once(input, opts); }
      catch (e) {
        if (e.code === 'cancelled' || shown || attempt >= 2 || !RETRYABLE.has(e.code)) {
          e.message = e.message || e.detail || '';
          if (e.code !== 'cancelled') console.warn('[Startline AI]', e.code, e.detail || '');
          throw e;
        }
        await sleep(e.code === 'rate_limited' ? 4000 : 1200 * (attempt + 1));
        if (o.signal && o.signal.aborted) throw { code: 'cancelled' };
      }
    }
  }

  sample.json = async function (input, o = {}) {
    const { text } = await sample(input, o);
    const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); } catch (_) {}
    for (const [a, b] of [['{', '}'], ['[', ']']]) {
      const i = t.indexOf(a), j = t.lastIndexOf(b);
      if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (_) {} }
    }
    throw { code: 'invalid_json', text };
  };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename || 'download';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    }
  };

  const caps = { sample, downloads, user: null, db: null };
  window.claude = { use: name => Promise.resolve(name in caps ? caps[name] : null) };
})();
