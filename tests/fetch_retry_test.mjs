// fetch_retry_test.mjs — renderer/net-retry.js 的行為測試（Node，無網路）
//   node tests/fetch_retry_test.mjs
// 迴歸重點：舊版（app.js 內）迴圈沒有上界（for (;;)），遇到 404 會永遠重試 →
// 開機畫面無限轉圈。這裡鎖住「4xx 立即失敗」「5xx/429 重試」「網路錯誤重試有限次」。

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  OK ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };

const { fetchWithRetry } = await import('../renderer/net-retry.js');
// 立即執行的 setTimeout（跳過退避等待）
const now = (fn) => { fn(); return 0; };
const make = (fetchImpl) => (url, retries = 4) => fetchWithRetry(url, {
  retries, fetchImpl, setTimeoutImpl: now, clearTimeoutImpl: () => {},
});

const res = (status) => ({ ok: status >= 200 && status < 300, status });

// 1) 404：立即失敗（且只呼叫一次）——舊版在這裡會無窮迴圈
{
  let calls = 0;
  const f = make(async () => { calls++; return res(404); });
  try { await f('assets/data/missing.json'); bad('404 應該丟錯'); }
  catch (e) { (calls === 1 && /HTTP 404/.test(e.message) ? ok : bad)(`404 立即失敗（calls=${calls}）`); }
}

// 2) 5xx ×2 → 200：重試後成功
{
  let calls = 0;
  const f = make(async () => { calls++; return calls < 3 ? res(503) : res(200); });
  const r = await f('assets/x.json');
  (r.status === 200 && calls === 3 ? ok : bad)(`5xx 重試後成功（calls=${calls}）`);
}

// 3) 5xx 一直失敗：有限次後丟錯（不會無限）
{
  let calls = 0;
  const f = make(async () => { calls++; return res(500); });
  try { await f('assets/x.json'); bad('5xx 全失敗應該丟錯'); }
  catch { (calls === 4 ? ok : bad)(`5xx 重試次數有上界（calls=${calls}）`); }
}

// 4) 網路錯誤：重試 4 次後丟最後一個錯誤
{
  let calls = 0;
  const f = make(async () => { calls++; throw new Error('Failed to fetch'); });
  try { await f('assets/x.json'); bad('網路錯誤應該丟錯'); }
  catch (e) { (calls === 4 && /Failed to fetch/.test(e.message) ? ok : bad)(`網路錯誤重試 4 次（calls=${calls}）`); }
}

// 5) 408/429 例外：仍要重試（可恢復的 4xx）
{
  let calls = 0;
  const f = make(async () => { calls++; return calls < 3 ? res(429) : res(200); });
  const r = await f('assets/x.json');
  (r.status === 200 && calls === 3 ? ok : bad)(`429 會重試（calls=${calls}）`);
}

console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
