// static/js/blue.js
// Frontend helper for B.L.U.E. slash command composition.

export async function composeBlueInvocation(args, options = {}) {
  const apiBase = options.apiBase || '';
  const input = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
  const res = await fetch(`${apiBase}/api/blue/compose`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || 'B.L.U.E. could not compose this request.');
  }

  window.__odysseusNextSendOverrides = {
    mode: 'agent',
    allow_web_search: data.allow_web_search !== false,
    allow_bash: data.allow_bash === true,
    source: 'blue',
  };
  return data;
}
