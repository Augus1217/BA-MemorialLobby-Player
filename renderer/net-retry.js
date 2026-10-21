// net-retry.js — 具備逾時與重試的 fetch（開機資料、atlas、語音檔都用它）。
//
// 設計：
//  - 只有「等不到回應標頭」才套逾時（預設 15s）。body 可能很大（2048² atlas
//    頁面、語音 ogg），設整體逾時會在慢網上把快要完成的下載砍掉；body 的
//    停滯交給瀏覽器 socket 自己收斂。
//  - 非 2xx 一定要有上界：舊版（app.js 內）迴圈沒有終止條件，只有 catch 會
//    throw——遇到 404 就會永遠重試＋每輪小睡，開機畫面無限轉圈。
//  - 4xx（除 408/429）不重試；5xx/網路錯誤指數退避重試。
export async function fetchWithRetry(url, {
  retries = 4,
  headTimeoutMs = 15000,
  backoffMs = (i) => 300 * i,
  fetchImpl = (...a) => fetch(...a),
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (id) => clearTimeout(id),
  AbortControllerImpl = AbortController,
} = {}) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    if (i > 0) await new Promise((res) => setTimeoutImpl(res, backoffMs(i)));
    const ac = new AbortControllerImpl();
    const timer = setTimeoutImpl(() => { try { ac.abort(); } catch {} }, headTimeoutMs);
    try {
      const r = await fetchImpl(url, { signal: ac.signal });
      clearTimeoutImpl(timer);
      if (r.ok) return r;
      lastErr = new Error(`HTTP ${r.status} for ${url}`);
      // 可恢復的 4xx/5xx → 繼續重試；其餘 4xx（404/403…）沒必要重試
      if (r.status >= 500 || r.status === 408 || r.status === 429) continue;
      throw lastErr;
    } catch (e) {
      clearTimeoutImpl(timer);
      lastErr = e;
      const m = String(e?.message || '');
      if (m.startsWith('HTTP 4') && !/^HTTP 40[89]|^HTTP 429/.test(m)) throw e;
      if (i >= retries - 1) throw lastErr;
    }
  }
  throw lastErr || new Error(`fetch failed: ${url}`);
}
