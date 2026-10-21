// tar-stream.js — 網頁版資源安裝的串流管線（不把整包放進記憶體）。
//
// 為什麼需要：舊版 ba-web.js 用 `gunzipSync(整個壓縮包)` ＋ 第二輪複製每個檔案，
// 400MB 級的包（assets-player）在手機上峰值約 2.5～3 倍＝必 OOM（分頁直接被砍）。
// 這裡改成：
//   1. 下載流邊算 sha256（純 JS 增量實作，WebCrypto 沒有增量 API），邊送進
//      DecompressionStream → Blob。大 Blob 由瀏覽器落地存放，不佔 JS 記憶體。
//   2. 逐 entry 讀 tar（含 PAX/GNU 長檔名），每個檔案用 Blob.slice() 交給
//      Cache Storage，記憶體用量 ≈ 單一檔案大小。
//
// 無 DecompressionStream 的舊瀏覽器由呼叫端退回舊路徑（ba-web.js 內保留）。

// ---------------------------------------------------------------------------
// SHA-256（增量；輸出與 crypto.subtle.digest('SHA-256') 一致）
// ---------------------------------------------------------------------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  constructor() {
    this.h = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.block = new Uint8Array(64);
    this.blockLen = 0;
    this.total = 0;          // 已吃進的位元組數
    this.w = new Uint32Array(64);
  }

  _compress() {
    const w = this.w, b = this.block;
    for (let i = 0; i < 16; i++) {
      const j = i * 4;
      w[i] = ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    const H = this.h;
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  update(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.total += u8.length;
    let off = 0;
    if (this.blockLen) {
      const need = Math.min(64 - this.blockLen, u8.length);
      this.block.set(u8.subarray(0, need), this.blockLen);
      this.blockLen += need;
      off = need;
      if (this.blockLen === 64) { this._compress(); this.blockLen = 0; }
    }
    while (off + 64 <= u8.length) {
      this.block.set(u8.subarray(off, off + 64));
      this._compress();
      off += 64;
    }
    if (off < u8.length) {
      this.block.set(u8.subarray(off), 0);
      this.blockLen = u8.length - off;
    }
    return this;
  }

  hex() {
    // 收尾（不破壞可再 update，但一般到此為止）：補 0x80、長度、再 compress。
    // padding 長度必須讓 (blockLen + padLen + 8) % 64 == 0——固定用 64/128 會讓
    // 長度欄位掉在未壓縮的尾巴上（>56 bytes 的輸入全部算錯）。
    const bitsHi = Math.floor(this.total / 0x20000000);   // total*8 / 2^32
    const bitsLo = (this.total * 8) >>> 0;
    const padLen = this.blockLen < 56 ? 56 - this.blockLen : 120 - this.blockLen;
    const padding = new Uint8Array(padLen + 8);
    padding[0] = 0x80;
    padding[padding.length - 8] = (bitsHi >>> 24) & 0xff;
    padding[padding.length - 7] = (bitsHi >>> 16) & 0xff;
    padding[padding.length - 6] = (bitsHi >>> 8) & 0xff;
    padding[padding.length - 5] = bitsHi & 0xff;
    padding[padding.length - 4] = (bitsLo >>> 24) & 0xff;
    padding[padding.length - 3] = (bitsLo >>> 16) & 0xff;
    padding[padding.length - 2] = (bitsLo >>> 8) & 0xff;
    padding[padding.length - 1] = bitsLo & 0xff;
    const tail = this.blockLen;
    // 跑完 padding 後把狀態還原（允許 digest 後繼續 update；total 要扣掉 padding）
    const saveH = this.h.slice();
    const saveLen = this.total;
    this.update(padding);
    const H = this.h;
    let out = '';
    for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0');
    // 還原（允許之後繼續 update；total 需扣掉 padding）
    this.h.set(saveH);
    this.total = saveLen;
    void tail;
    return out;
  }
}

export function sha256Hex(bytes) {
  return new Sha256().update(bytes).hex();
}

// ---------------------------------------------------------------------------
// 下載 → gunzip → Blob（邊串流邊算壓縮檔的 sha256）
// ---------------------------------------------------------------------------
/**
 * @param {ReadableStream<Uint8Array>} body  fetch 的 response.body
 * @param {number} total                     Content-Length（可 0）
 * @param {(received:number,total:number)=>void} onBytes
 * @returns {Promise<{blob: Blob, sha256: string}>}
 */
export async function gunzipStreamToBlob(body, total, onBytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('DecompressionStream unavailable');
  if (!body) throw new Error('response body missing');
  const hasher = new Sha256();
  let received = 0;
  const tap = new TransformStream({
    transform(chunk, ctrl) {
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      hasher.update(u8);
      received += u8.length;
      try { onBytes?.(received, total); } catch {}
      ctrl.enqueue(u8);
    },
  });
  const decompressed = body.pipeThrough(tap).pipeThrough(new DecompressionStream('gzip'));
  const blob = await new Response(decompressed).blob();
  return { blob, sha256: hasher.hex() };
}

// ---------------------------------------------------------------------------
// tar 讀取（ustar / PAX / GNU 長檔名；逐 entry 回傳 Blob）
// ---------------------------------------------------------------------------
const WINDOW = 256 * 1024;   // 一次抓 256KB，避免每個 header 都 await 一次

class BlobReader {
  constructor(blob) { this.blob = blob; this.base = 0; this.buf = new Uint8Array(0); }
  async ensure(absOff, len) {
    if (absOff >= this.base && absOff + len <= this.base + this.buf.length) return;
    this.base = absOff;
    this.buf = new Uint8Array(await this.blob.slice(absOff, Math.min(absOff + WINDOW, this.blob.size)).arrayBuffer());
  }
  async bytes(absOff, len) {
    await this.ensure(absOff, len);
    const rel = absOff - this.base;
    if (rel + len > this.buf.length) {         // 跨視窗（entry 很大時不會走這裡）
      return new Uint8Array(await this.blob.slice(absOff, absOff + len).arrayBuffer());
    }
    return this.buf.subarray(rel, rel + len);
  }
}

const td = new TextDecoder('utf-8');
function cstr(bytes) {
  let end = 0;
  while (end < bytes.length && bytes[end]) end++;
  return td.decode(bytes.subarray(0, end));
}
function paxPath(data) {
  for (const line of td.decode(data).split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(line.indexOf(' ') + 1, eq) === 'path') return line.slice(eq + 1);
  }
  return null;
}

/**
 * 逐 entry 走訪 tar（不載入整包）。
 * @param {Blob} blob 已 gunzip 的 tar
 * @param {(name:string, size:number, body:Blob)=>Promise<void>|void} onEntry
 * @returns {Promise<{count:number}>}
 */
export async function iterateTar(blob, onEntry) {
  const rd = new BlobReader(blob);
  let off = 0, longName = null, paxName = null, count = 0;
  while (off + 512 <= blob.size) {
    const header = await rd.bytes(off, 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) if (header[i]) { allZero = false; break; }
    if (allZero) break;
    const sizeStr = cstr(header.subarray(124, 136)).trim();
    const size = sizeStr ? (parseInt(sizeStr, 8) || 0) : 0;
    const typeFlag = String.fromCharCode(header[156]);
    const dataOff = off + 512;
    if (typeFlag === 'x' || typeFlag === 'g') {
      if (typeFlag === 'x') {
        const data = await rd.bytes(dataOff, Math.min(size, WINDOW));
        paxName = paxPath(data) || paxName;
      }
    } else if (typeFlag === 'L') {
      longName = cstr(await rd.bytes(dataOff, Math.min(size, WINDOW)));
    } else if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
      let name = longName || paxName;
      if (!name) {
        const base = cstr(header.subarray(0, 100));
        const prefix = cstr(header.subarray(345, 500));
        name = prefix ? prefix + '/' + base : base;
      }
      await onEntry(name, size, blob.slice(dataOff, dataOff + size));
      count++;
      longName = null; paxName = null;
    } else {
      longName = null; paxName = null;      // 目錄/連結等：略過
    }
    off = dataOff + Math.ceil(size / 512) * 512;
  }
  return { count };
}

// ---------------------------------------------------------------------------
// 停滯守門員：超過 ms 沒有任何新資料就讓串流失敗（並由呼叫端 abort 底層
// fetch）。慢速但持續有資料的連線不受影響——慢網不該被砍。
// ---------------------------------------------------------------------------
export function stallGuard(src, ms, onStall) {
  let timer = null, done = false;
  const arm = (ctrl) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (done) return;
      try { onStall?.(); } catch {}
      try { ctrl.error(new Error('stalled')); } catch {}
    }, ms);
  };
  return src.pipeThrough(new TransformStream({
    start(ctrl) { arm(ctrl); },
    transform(chunk, ctrl) { arm(ctrl); ctrl.enqueue(chunk); },
    flush() { done = true; if (timer) clearTimeout(timer); },
  }));
}
