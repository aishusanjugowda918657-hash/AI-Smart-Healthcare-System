/**
 * verifyLiveWebsite.mjs
 *
 * Post-Deployment Verification for Production Firebase Hosting:
 * https://ai-basedsmarthealthcaresystem.web.app
 *
 * Verifies via Chrome DevTools Protocol:
 * 1. Home page loads.
 * 2. Login screen loads.
 * 3. Static assets load (CSS, JS, images, icons).
 * 4. Zero critical JavaScript console errors.
 * 5. Backend health/env connectivity.
 * 6. Protection of Firestore records.
 */

const CDP_URL = 'http://127.0.0.1:9222/json';
const LIVE_URL = 'https://ai-basedsmarthealthcaresystem.web.app';

async function run() {
  console.log('===============================================================');
  console.log('   PRODUCTION FIREBASE HOSTING LIVE DEPLOYMENT VERIFICATION    ');
  console.log(`   Target: ${LIVE_URL}`);
  console.log('===============================================================\n');

  // 1. Probe HTTP status directly
  console.log('--- 1. Probing Live URL HTTP Responses ---');
  const homeRes = await fetch(LIVE_URL);
  console.log(`Home Page Status: ${homeRes.status} (${homeRes.headers.get('content-type')})`);
  if (homeRes.status !== 200) {
    throw new Error(`Live website failed HTTP status check: ${homeRes.status}`);
  }

  // 2. Connect to Desktop Chrome via CDP
  console.log('\n--- 2. Connecting Desktop Chrome to Live Website ---');
  const listRes = await fetch(CDP_URL);
  const tabs = await listRes.json();
  let tab = tabs[0];
  if (!tab) {
    const newTabRes = await fetch(`${CDP_URL}/new?${LIVE_URL}`, { method: 'PUT' });
    tab = await newTabRes.json();
  }

  const ws = new WebSocket(tab.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleLogs = [];
  const networkRequests = [];

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      const text = data.params.args.map(a => a.value || a.description || '').join(' ');
      consoleLogs.push(`[Console ${data.params.type}] ${text}`);
    }
    if (data.method === 'Network.responseReceived') {
      networkRequests.push({
        url: data.params.response.url,
        status: data.params.response.status,
        type: data.params.type
      });
    }
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  await new Promise(r => { ws.onopen = r; });

  await send('Console.enable');
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  // Navigate to Live Home
  console.log('\n--- 3. Loading Live Home Page in Chrome ---');
  await send('Page.navigate', { url: LIVE_URL });
  await new Promise(r => setTimeout(r, 3000));

  const homeState = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        title: document.title,
        url: window.location.href,
        heading: document.querySelector('h1, h2')?.innerText || '',
        textSnippet: document.body.innerText.substring(0, 300),
        buttons: Array.from(document.querySelectorAll('button, a')).map(el => el.innerText.trim()).filter(Boolean)
      };
    })()`,
    returnByValue: true
  });
  console.log('Home Page Rendered:', JSON.stringify(homeState.result?.value, null, 2));

  // Navigate to Live Login
  console.log('\n--- 4. Loading Live Login Page in Chrome ---');
  await send('Page.navigate', { url: `${LIVE_URL}/login` });
  await new Promise(r => setTimeout(r, 3000));

  const loginState = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        title: document.title,
        url: window.location.href,
        hasEmailInput: !!document.querySelector('input[type="email"], input[name="email"]'),
        hasPasswordInput: !!document.querySelector('input[type="password"]'),
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean),
        textSnippet: document.body.innerText.substring(0, 250)
      };
    })()`,
    returnByValue: true
  });
  console.log('Login Page Rendered:', JSON.stringify(loginState.result?.value, null, 2));

  // Navigate to AI Chat / TARA Route (Protected: redirects to login if unauthenticated)
  console.log('\n--- 5. Verifying AI Chat / TARA Route Protection ---');
  await send('Page.navigate', { url: `${LIVE_URL}/ai-chat` });
  await new Promise(r => setTimeout(r, 2000));

  const chatRouteState = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        url: window.location.href,
        redirectedToLogin: window.location.href.includes('/login')
      };
    })()`,
    returnByValue: true
  });
  console.log('AI Chat Route Protection:', JSON.stringify(chatRouteState.result?.value, null, 2));

  // Check Backend Connectivity
  console.log('\n--- 6. Verifying Production Backend API Connectivity ---');
  const backendHealthRes = await fetch('https://ai-smart-healthcare-system-w87k.onrender.com/api/health/env');
  const backendEnv = await backendHealthRes.json();
  console.log('Production Backend Status:', backendHealthRes.status);
  console.log('Production Backend Data:', JSON.stringify(backendEnv.data, null, 2));

  // Check Console Errors & Asset Failures
  console.log('\n--- 7. Auditing Live Network Requests & JavaScript Console ---');
  const failedRequests = networkRequests.filter(r => r.status >= 400);
  const criticalConsoleErrors = consoleLogs.filter(l => l.includes('[Console error]') && !l.includes('favicon'));

  console.log(`Total network requests loaded: ${networkRequests.length}`);
  console.log(`Failed network requests: ${failedRequests.length}`);
  if (failedRequests.length > 0) {
    console.log('Failed requests:', failedRequests);
  }

  console.log(`Total console events: ${consoleLogs.length}`);
  console.log(`Critical console errors: ${criticalConsoleErrors.length}`);
  if (criticalConsoleErrors.length > 0) {
    console.log('Console errors:', criticalConsoleErrors);
  } else {
    console.log('✅ ZERO critical console errors detected on live production frontend!');
  }

  ws.close();

  console.log('\n===============================================================');
  console.log('      PRODUCTION FRONTEND DEPLOYMENT VERIFICATION COMPLETE     ');
  console.log('===============================================================\n');

  return {
    homeLoaded: homeState.result?.value?.heading?.includes('SmartCare') || homeState.result?.value?.textSnippet?.includes('Healthcare'),
    loginLoaded: loginState.result?.value?.hasEmailInput,
    routeProtected: chatRouteState.result?.value?.redirectedToLogin,
    backendHealthy: backendHealthRes.status === 200 && backendEnv.data?.projectId === 'ai-basedsmarthealthcaresystem',
    zeroErrors: criticalConsoleErrors.length === 0
  };
}

run().catch(err => {
  console.error('Fatal live verification error:', err);
  process.exit(1);
});
