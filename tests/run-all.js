/* Runs every test file in order. Usage: node tests/run-all.js */
const { spawnSync } = require('child_process');
const path = require('path');
const files = ['core.test.js', 'quizui.test.js', 'pages.test.js', 'spell.test.js', 'accent.test.js', 'flash.test.js', 'blaster.test.js', 'platformer.test.js', 'browser.test.js'];
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', env: process.env });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f + ' (' + Math.round((Date.now() - t0) / 1000) + 's)');
}
console.log(failed ? failed + ' test file(s) failed' : 'ALL TEST FILES PASSED');
process.exit(failed ? 1 : 0);
