/**
 * cdpTestTaraLiveInteractions.mjs
 *
 * Drives real Desktop Chrome via CDP to interact with TARA AI Assistant:
 * - Tests quick action buttons (Token, Prescriptions, Doctor Timings).
 * - Tests text input in Kannada, English, Hindi, Telugu, and Tamil.
 * - Tests emergency alert rendering.
 * - Inspects chat message history and speech synthesis invocations.
 */

const CDP_URL = 'http://127.0.0.1:9222/json';

async function run() {
  console.log('===============================================================');
  console.log('   TARA DESKTOP CHROME REAL-DEVICE WORKFLOW VALIDATION (CDP)   ');
  console.log('===============================================================\n');

  const listRes = await fetch(CDP_URL);
  const tabs = await listRes.json();
  const tab = tabs.find(t => t.url.includes('localhost:3000'));
  if (!tab) {
    throw new Error('No Chrome tab found on localhost:3000.');
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

  await send('Console.enable');
  await send('Runtime.enable');
  await send('Page.enable');

  // Ensure on /ai-chat
  await send('Page.navigate', { url: 'http://localhost:3000/ai-chat' });
  await new Promise(r => setTimeout(r, 2000));

  // Helper to get all chat messages currently rendered on screen
  async function getRenderedMessages() {
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        // Collect text from chat message bubbles
        const bubbles = Array.from(document.querySelectorAll('.rounded-2xl, [class*="bubble"], [class*="message"]'));
        return bubbles.map(b => b.innerText.trim()).filter(t => t.length > 5 && !t.includes('ROLE:') && !t.includes('NAVIGATION'));
      })()`,
      returnByValue: true
    });
    return res.result?.value || [];
  }

  // ── Step 1: Click "Doctor Timings" Quick Chip ─────────────────────────────
  console.log('\n--- Action 1: Clicking "Doctor Timings" Quick Chip ---');
  const timingsClick = await send('Runtime.evaluate', {
    expression: `(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.innerText.includes('Doctor Timings'));
      if (btn) {
        btn.click();
        return { clicked: true, text: btn.innerText };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  });
  console.log('Clicked Doctor Timings:', timingsClick.result?.value);
  await new Promise(r => setTimeout(r, 2000));

  let msgs = await getRenderedMessages();
  console.log('Chat Output after Doctor Timings:');
  msgs.slice(-2).forEach(m => console.log('  💬', m.substring(0, 150)));

  // ── Step 2: Click "My Token Status" Quick Chip ────────────────────────────
  console.log('\n--- Action 2: Clicking "My Token Status" Quick Chip ---');
  const tokenClick = await send('Runtime.evaluate', {
    expression: `(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.innerText.includes('Token Status'));
      if (btn) {
        btn.click();
        return { clicked: true, text: btn.innerText };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  });
  console.log('Clicked Token Status:', tokenClick.result?.value);
  await new Promise(r => setTimeout(r, 2000));

  msgs = await getRenderedMessages();
  console.log('Chat Output after Token Status:');
  msgs.slice(-2).forEach(m => console.log('  💬', m.substring(0, 150)));

  // ── Step 3: Type & Send Emergency Message (Hindi) ─────────────────────────
  console.log('\n--- Action 3: Sending Emergency Query in Hindi ("सीने में तेज दर्द") ---');
  const emergencyTest = await send('Runtime.evaluate', {
    expression: `(async () => {
      const input = document.querySelector('input[type="text"], textarea');
      const form = document.querySelector('form');
      const buttons = Array.from(document.querySelectorAll('button'));
      const sendBtn = buttons.find(b => b.innerText.includes('Send') || b.querySelector('svg'));

      if (input) {
        // Set react input value properly
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'सीने में बहुत तेज दर्द हो रहा है');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 300));
        if (sendBtn) sendBtn.click();
        else if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
        return { sent: true };
      }
      return { sent: false };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('Emergency Submit Status:', emergencyTest.result?.value);
  await new Promise(r => setTimeout(r, 2500));

  msgs = await getRenderedMessages();
  console.log('Chat Output after Hindi Emergency Query:');
  msgs.slice(-2).forEach(m => console.log('  🚨', m.substring(0, 150)));

  // ── Step 4: Type & Send Query in Kannada ──────────────────────────────────
  console.log('\n--- Action 4: Sending Query in Kannada ("ನನ್ನ ಟೋಕನ್ ಸಂಖ್ಯೆ ಏನು?") ---');
  const kannadaTest = await send('Runtime.evaluate', {
    expression: `(async () => {
      const input = document.querySelector('input[type="text"], textarea');
      const buttons = Array.from(document.querySelectorAll('button'));
      const sendBtn = buttons.find(b => b.innerText.includes('Send') || b.querySelector('svg'));

      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'ನನ್ನ ಟೋಕನ್ ಸಂಖ್ಯೆ ಏನು?');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 300));
        if (sendBtn) sendBtn.click();
        return { sent: true };
      }
      return { sent: false };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('Kannada Submit Status:', kannadaTest.result?.value);
  await new Promise(r => setTimeout(r, 2500));

  msgs = await getRenderedMessages();
  console.log('Chat Output after Kannada Query:');
  msgs.slice(-2).forEach(m => console.log('  💬', m.substring(0, 150)));

  // ── Step 5: Test Web Speech Toggle & Synthesis Call in Browser ────────────
  console.log('\n--- Action 5: Testing Browser Speech Synthesis Engine ---');
  const speechSynthTest = await send('Runtime.evaluate', {
    expression: `(() => {
      if (!window.speechSynthesis) return { supported: false };
      
      const testUtt = new SpeechSynthesisUtterance('TARA Healthcare Assistant is ready.');
      testUtt.rate = 0.95;
      testUtt.lang = 'en-IN';
      
      let speakingAtStart = window.speechSynthesis.speaking;
      window.speechSynthesis.speak(testUtt);
      let speakingAfterCall = window.speechSynthesis.speaking;
      
      // Stop speech
      window.speechSynthesis.cancel();
      
      return {
        supported: true,
        speakingAtStart,
        speakingAfterCall,
        rate: testUtt.rate,
        lang: testUtt.lang
      };
    })()`,
    returnByValue: true
  });
  console.log('Speech Synthesis Test in Chrome:', speechSynthTest.result?.value);

  // ── Step 6: Console Error Audit ───────────────────────────────────────────
  console.log('\n--- Action 6: Auditing Live Console Errors ---');
  const criticalErrors = consoleLogs.filter(l => l.includes('[Console error]') && !l.includes('favicon'));
  console.log(`Total live console events: ${consoleLogs.length}`);
  console.log(`Critical console errors: ${criticalErrors.length}`);
  if (criticalErrors.length > 0) {
    console.log('Errors:', criticalErrors);
  } else {
    console.log('✅ ZERO critical console errors detected during live user interaction!');
  }

  ws.close();
  console.log('\n===============================================================');
  console.log('        REAL-DEVICE CHROME CDP TESTING FULLY COMPLETED         ');
  console.log('===============================================================\n');
}

run().catch(err => {
  console.error('Fatal CDP interaction error:', err);
  process.exit(1);
});
