const fs = require('fs');
const http = require('http');
const path = require('path');

const TARGET_LABEL = String(process.env.ORACLE_MIC_SELECTOR_LABEL || 'B microphone').trim();
const APP_URL = process.env.ORACLE_MIC_SELECTOR_URL || 'http://127.0.0.1:7000/?codexqa=oracle-mic-selector-v1';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

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
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:7000'))
    || tabs.find(t => t.type === 'page');
  if (!tab) throw new Error('No CDP page tab found at http://127.0.0.1:9226');

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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await send('Page.navigate', { url: APP_URL });
  await new Promise(resolve => setTimeout(resolve, 3500));

  const expression = `
(async () => {
  const targetLabel = ${JSON.stringify(TARGET_LABEL)};
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 18000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await wait(150);
    }
    return null;
  };

  const select = await waitFor(() => document.querySelector('#oracle-mic-select'));
  if (!select) throw new Error('oracle-mic-select not found');
  const runtime = await waitFor(() => window.oracleVoiceRuntime);
  if (!runtime) throw new Error('window.oracleVoiceRuntime not found');

  const rect = select.getBoundingClientRect();
  const style = window.getComputedStyle(select);
  const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  if (!visible) throw new Error('oracle-mic-select is not visible');

  try {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissionStream.getTracks().forEach(track => track.stop());
  } catch (_) {}

  select.focus();
  select.click();
  await wait(1600);

  const options = Array.from(select.options).map((option, index) => ({
    index,
    value: option.value,
    label: option.textContent.trim(),
    deviceId: option.dataset.deviceId || '',
    deviceLabel: option.dataset.deviceLabel || '',
  }));
  const target = options.find(option => (
    option.deviceId && option.label.toLowerCase().includes(targetLabel.toLowerCase())
  )) || options.find(option => option.label.toLowerCase().includes(targetLabel.toLowerCase()));
  if (!target) {
    throw new Error('target microphone option not found: ' + targetLabel + ' options=' + options.map(o => o.label).join(', '));
  }

  select.value = target.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(500);

  const preferredDevice = runtime.micCapture && typeof runtime.micCapture.getPreferredDevice === 'function'
    ? runtime.micCapture.getPreferredDevice()
    : null;
  if (!preferredDevice || !String(preferredDevice.label || '').toLowerCase().includes(targetLabel.toLowerCase())) {
    throw new Error('preferred microphone was not persisted');
  }

  const button = document.querySelector('#oracle-voice-btn');
  if (!button) throw new Error('oracle-voice-btn not found');
  button.click();
  await wait(2500);
  const status = runtime.status || {};
  const selectedDeviceLabel = status.microphone && status.microphone.selectedDeviceLabel
    ? status.microphone.selectedDeviceLabel
    : '';
  if (!selectedDeviceLabel.toLowerCase().includes(targetLabel.toLowerCase())) {
    throw new Error('active microphone track did not use target device: ' + JSON.stringify({
      selectedDeviceLabel,
      target,
      preferredDevice,
      options,
      microphone: status.microphone || null,
    }));
  }

  if (typeof runtime.hardCancel === 'function') {
    await runtime.hardCancel('oracle_mic_selector_qa').catch(() => {});
  } else if (typeof runtime.stopMicrophone === 'function') {
    runtime.stopMicrophone('idle');
  }

  return {
    selectorVisible: visible,
    optionCount: options.length,
    targetOption: target,
    preferredDevice,
    selectedDeviceLabel,
    runtimeState: status.state,
    microphoneState: status.microphoneState,
  };
})()
`;
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
  }

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const desktopShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'oracle-mic-selector-desktop.png'), Buffer.from(desktopShot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send('Runtime.evaluate', {
    expression: `(() => {
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (sidebar) sidebar.classList.add('hidden');
      if (backdrop) backdrop.classList.remove('visible');
      document.body.classList.add('sidebar-collapsed');
      return true;
    })()`,
    returnByValue: true,
  }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 600));
  const mobileShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'oracle-mic-selector-mobile.png'), Buffer.from(mobileShot.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  ws.close();

  console.log(JSON.stringify({
    passed: true,
    targetLabel: TARGET_LABEL,
    result: result.result.value,
    screenshots: [
      'artifacts/screenshots/oracle-mic-selector-desktop.png',
      'artifacts/screenshots/oracle-mic-selector-mobile.png',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ passed: false, error: error.message }, null, 2));
  process.exit(1);
});
