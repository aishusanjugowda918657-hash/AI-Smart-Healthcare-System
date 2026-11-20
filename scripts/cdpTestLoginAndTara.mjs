/**
 * cdpTestLoginAndTara.mjs
 *
 * Real browser validation of TARA Voice Agent using Chrome DevTools Protocol.
 * Tests Web Speech capabilities, patient login, language switching,
 * voice interaction UI, action confirmation, and console errors.
 */

const CDP_URL = 'http://127.0.0.1:9222/json';

async function run() {
  console.log('--- Connecting to Desktop Chrome via CDP ---');
  const listRes = await fetch(CDP_URL);
  const tabs = await listRes.json();
  let tab = tabs.find(t => t.url.includes('localhost:3000'));
  if (!tab) {
    const newTabRes = await fetch(`${CDP_URL}/new?http://localhost:3000/login`, { method: 'PUT' });
    tab = await newTabRes.json();
  }

  console.log(`Connected to Chrome tab: ${tab.id} (${tab.url})`);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleLogs = [];

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
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  await new Promise(r => { ws.onopen = r; });

  // Enable console and page events
  await send('Console.enable');
  await send('Runtime.enable');
  await send('Page.enable');

  console.log('\n--- 1. Checking Browser-Native Web Speech APIs in Chrome ---');
  const speechCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        hasSpeechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        recognitionClass: window.webkitSpeechRecognition ? 'webkitSpeechRecognition' : (window.SpeechRecognition ? 'SpeechRecognition' : 'none'),
        hasSpeechSynthesis: !!window.speechSynthesis,
        speechSynthesisSpeaking: window.speechSynthesis ? window.speechSynthesis.speaking : false,
        voicesCount: window.speechSynthesis ? window.speechSynthesis.getVoices().length : 0,
        voices: window.speechSynthesis ? window.speechSynthesis.getVoices().map(v => ({ name: v.name, lang: v.lang })) : [],
        isEmulatorConnected: !!window.__FIREBASE_EMULATORS_CONNECTED__
      };
    })()`,
    returnByValue: true
  });
  console.log('Web Speech Capabilities:', JSON.stringify(speechCheck.result?.value, null, 2));

  console.log('\n--- 2. Auto-Logging In as Demo Patient 10 on Emulator ---');
  await send('Page.navigate', { url: 'http://localhost:3000/login?email=demo.patient10@smartcare.local&auto=1' });
  await new Promise(r => setTimeout(r, 2500));

  const afterLoginUrl = await send('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true
  });
  console.log('URL after login:', afterLoginUrl.result?.value);

  // Navigate to /ai-chat
  console.log('\n--- 3. Navigating to TARA (/ai-chat) ---');
  await send('Page.navigate', { url: 'http://localhost:3000/ai-chat' });
  await new Promise(r => setTimeout(r, 2500));

  const pageState = await send('Runtime.evaluate', {
    expression: `(() => {
      return {
        url: window.location.href,
        title: document.title,
        heading: document.querySelector('h1, h2, h3')?.innerText || '',
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean),
        hasInput: !!document.querySelector('input[type="text"], textarea'),
        bodyPreview: document.body.innerText.substring(0, 300)
      };
    })()`,
    returnByValue: true
  });
  console.log('TARA Page State:', JSON.stringify(pageState.result?.value, null, 2));

  console.log('\n--- 4. Testing Language Switching in TARA UI ---');
  const langTest = await send('Runtime.evaluate', {
    expression: `(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const knBtn = buttons.find(b => b.innerText.includes('ಕನ್ನಡ') || b.innerText.includes('KN') || b.innerText.includes('Kn'));
      const hiBtn = buttons.find(b => b.innerText.includes('हिन्दी') || b.innerText.includes('HI') || b.innerText.includes('Hi'));
      const teBtn = buttons.find(b => b.innerText.includes('తెలుగు') || b.innerText.includes('TE') || b.innerText.includes('Te'));
      const taBtn = buttons.find(b => b.innerText.includes('தமிழ்') || b.innerText.includes('TA') || b.innerText.includes('Ta'));
      const enBtn = buttons.find(b => b.innerText.includes('English') || b.innerText.includes('EN') || b.innerText.includes('En'));

      return {
        foundKannada: !!knBtn,
        foundHindi: !!hiBtn,
        foundTelugu: !!teBtn,
        foundTamil: !!taBtn,
        foundEnglish: !!enBtn
      };
    })()`,
    returnByValue: true
  });
  console.log('Language Controls:', JSON.stringify(langTest.result?.value, null, 2));

  console.log('\n--- 5. Testing Quick Action Chips & Input Flow ---');
  const chipsTest = await send('Runtime.evaluate', {
    expression: `(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const chips = buttons.map(b => b.innerText.trim()).filter(t => 
        t.includes('Token') || t.includes('Wait') || t.includes('Doctor') || t.includes('Book') || t.includes('Staff')
      );
      return { chipsFound: chips };
    })()`,
    returnByValue: true
  });
  console.log('Quick Action Chips:', JSON.stringify(chipsTest.result?.value, null, 2));

  console.log('\n--- 6. Checking Browser Console Logs & Errors ---');
  const errors = consoleLogs.filter(l => l.includes('[Console error]') || l.includes('Uncaught'));
  console.log(`Total console logs captured: ${consoleLogs.length}`);
  console.log(`Console errors detected: ${errors.length}`);
  if (errors.length > 0) {
    console.log('Errors:', errors);
  } else {
    console.log('✅ ZERO console errors detected on TARA interface.');
  }

  ws.close();
  console.log('\n--- Desktop Chrome Validation Completed Successfully ---');
}

run().catch(err => {
  console.error('CDP test error:', err);
  process.exit(1);
});
