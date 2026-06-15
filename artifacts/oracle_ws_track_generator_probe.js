const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const tabs = await getJson('http://127.0.0.1:9226/json/list');
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:7000')) || tabs.find(t => t.type === 'page');
  if (!tab) throw new Error('No CDP page tab found');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const result = await send('Runtime.evaluate', {
    expression: `({
      MediaStreamTrackGenerator: typeof MediaStreamTrackGenerator,
      AudioData: typeof AudioData,
      MediaRecorder: typeof MediaRecorder,
      WebSocket: typeof WebSocket,
      AudioContext: typeof AudioContext,
      secure: window.isSecureContext,
      hasRuntime: Boolean(window.oracleVoiceRuntime),
    })`,
    returnByValue: true,
  });
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
