// tar_stream_test.mjs — renderer/tar-stream.js 單元測試（Node 18+，無網路）
//   node tests/tar_stream_test.mjs
// 驗證：增量 SHA-256 與 node:crypto 一致；串流 gunzip→Blob→tar 走訪能正確處理
// ustar / PAX（長檔名、非 ASCII）/ GNU longname，內容與 sha 都對得上。
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Sha256, gunzipStreamToBlob, iterateTar } from '../renderer/tar-stream.js';

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  OK ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };

// ---- 1. SHA-256 正確性 ----
for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 127, 1000, 65536, 300000]) {
  const data = n ? randomBytes(n) : new Uint8Array(0);
  const want = createHash('sha256').update(data).digest('hex');
  // 分塊餵（模擬串流；Chrome/Safari 的 chunk 邊界不固定）
  const h = new Sha256();
  for (let i = 0; i < data.length; i += 7919) h.update(data.subarray(i, i + 7919));
  const got = h.hex();
  (got === want ? ok : bad)(`sha256 ${n} bytes${got === want ? '' : ` got=${got.slice(0, 16)} want=${want.slice(0, 16)}`}`);
}

// ---- 2. tar 走訪（由 python3 tarfile 產生真實 fixture）----
const dir = mkdtempSync(join(tmpdir(), 'ba-tar-test-'));
execFileSync('python3', [new URL('./make_tar_fixtures.py', import.meta.url).pathname, dir]);
const gz = (n) => readFileSync(join(dir, `${n}.tar.gz`));
const gzUstar = gz('ustar');
const gzPax = gz('pax');
const gzGnu = gz('gnu');
const EXISTING = ['ustar', 'pax', 'gnu'];

// 以隨機 chunk 大小的 ReadableStream 模擬 fetch body
function bodyOf(buf, chunk = 64 * 1024) {
  let off = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (off >= buf.length) return ctrl.close();
      const end = Math.min(off + chunk, buf.length);
      ctrl.enqueue(new Uint8Array(buf.subarray(off, end)));
      off = end;
    },
  });
}

for (const [label, buf, expect] of [['ustar', gzUstar, 2], ['PAX', gzPax, 4], ['GNU', gzGnu, 4]]) {
  let bytesSeen = 0;
  const { blob, sha256 } = await gunzipStreamToBlob(bodyOf(buf, 9973), buf.length, (r) => { bytesSeen = r; });
  const wantSha = createHash('sha256').update(buf).digest('hex');
  (sha256 === wantSha ? ok : bad)(`${label}: 串流 sha256（壓縮檔）`);
  (bytesSeen === buf.length ? ok : bad)(`${label}: 位元組計數 ${bytesSeen}/${buf.length}`);
  const entries = new Map();
  const { count } = await iterateTar(blob, async (name, size, body) => {
    entries.set(name, { size, data: new Uint8Array(await body.arrayBuffer()) });
  });
  (count === expect ? ok : bad)(`${label}: entry 數 ${count}（預期 ${expect}）`);
  if (expect > 2) {
    const longKey = [...entries.keys()].find((k) => k.includes('x'.repeat(20)));
    const jpKey = [...entries.keys()].find((k) => k.includes('日本語'));
    (longKey && longKey.endsWith('.png') ? ok : bad)(`${label}: 長檔名解析（>100 bytes）`);
    (jpKey ? ok : bad)(`${label}: 非 ASCII 檔名解析`);
  }
  const skel = entries.get('assets/spine/CH0001_home/skeleton.skel');
  const wantSkel = Buffer.concat([
    Buffer.from('SKEL'),
    Buffer.from(Array.from({ length: 256 * 40 }, (_, i) => i % 256)),
  ]);
  (skel && Buffer.compare(Buffer.from(skel.data), wantSkel) === 0 ? ok : bad)(`${label}: 大檔內容一致`);
  (entries.get('assets/data/lobby_index.json')?.data.length === 18 ? ok : bad)(`${label}: 小檔內容長度`);
}
void EXISTING;

// ---- 3. 壞資料：截斷的 tar 不應無限迴圈 ----
{
  const { blob } = await gunzipStreamToBlob(bodyOf(gzUstar), gzUstar.length, () => {});
  const truncated = blob.slice(0, Math.floor(blob.size / 2));
  let n = 0;
  await iterateTar(truncated, () => { n++; });
  (n >= 0 && n <= 4 ? ok : bad)(`截斷 tar 可安全結束（entry=${n}）`);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
