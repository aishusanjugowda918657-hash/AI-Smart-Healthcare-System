import { writeFileSync } from 'fs';

async function run() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const target = targets.find(t => t.url.includes('localhost:3000'));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let idCounter = 1;
  const pendingRequests = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await send('Runtime.evaluate', { expression: 'window.location.href = "http://localhost:3000/patient-dashboard"' });
  await new Promise(r => setTimeout(r, 2000));
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 700)' });
  await new Promise(r => setTimeout(r, 1000));

  const snap = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('C:/Users/Archana/.gemini/antigravity-ide/brain/5b30f0a6-8519-4a45-93a7-e34bcf6f7e67/f3_dashboard_scrolled.png', Buffer.from(snap.data, 'base64'));
  console.log('Saved scrolled screenshot successfully!');
  ws.close();
}

run().catch(console.error);
