// Capture a real-time screenshot of the running dev server via the Chrome DevTools Protocol.
// Usage: node scripts/screenshot.mjs <url> <out.png> [waitSeconds] [width] [height]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [url, out, wait = '10', width = '1440', height = '900'] = process.argv.slice(2);
const port = 9333;
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, '--user-data-dir=/tmp/lemmo-shot', 'about:blank'],
{ stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ }
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(+wait * 1000);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
ws.close();
chrome.kill();
console.log('saved', out);
