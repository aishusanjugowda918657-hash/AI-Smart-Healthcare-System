const CHROME_CDP_PORT = 9223;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  const res = await fetch('http://127.0.0.1:9223/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000')) || targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  const evalCmd = (expr) => new Promise((resolve) => {
    const reqId = id++;
    const handler = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id === reqId) {
        ws.removeEventListener('message', handler);
        resolve(msg.result?.result?.value);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: reqId, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });

  console.log('Navigating explicitly to /admin-dashboard...');
  await evalCmd('window.location.href = "http://localhost:3000/admin-dashboard"');
  await sleep(3000);

  const currentUrl = await evalCmd('window.location.href');
  console.log('Current URL:', currentUrl);
  const header = await evalCmd('document.querySelector("h1")?.innerText');
  console.log('Page Header:', header);
  const subtitle = await evalCmd('document.querySelector("p")?.innerText');
  console.log('Page Subtitle/P:', subtitle);
  const buttons = await evalCmd('Array.from(document.querySelectorAll("button")).map(b => b.innerText.trim()).filter(Boolean)');
  console.log('All Buttons:', buttons);

  ws.close();
}

run().catch(console.error);
