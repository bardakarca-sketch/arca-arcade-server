// Kullanım: node capture.js preview <t1,t2,...>   |   node capture.js render <ffmpeg> <wav> <out.mp4>
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const [mode, a1, a2, a3] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const errs = []; p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) });
  await p.goto('http://127.0.0.1:8765/index.html');
  await p.waitForFunction('window.ready===true', null, { timeout: 120000 });
  if (errs.length) console.log('HATALAR:', errs);
  if (mode === 'preview') {
    for (const t of a1.split(',').map(Number)) {
      const s = Date.now(); await p.evaluate(t => renderAt(t), t);
      await p.screenshot({ path: path.join(__dirname, `prev_${t}.jpg`), type: 'jpeg', quality: 85 });
      console.log('t', t, (Date.now() - s) + 'ms');
    }
  } else {
    const total = await p.evaluate('TOTAL'); const n = Math.ceil(total * 30);
    const ff = spawn(a1, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-i', a2,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', a3], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await p.evaluate(t => renderAt(t), i / 30);
      const buf = await p.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 150 === 0) console.log(`kare ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('bitti', a3);
  }
  await b.close();
})();
