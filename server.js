// Free-Mint Safety Screener — Wildcard track, Agent Games zkVerify Season 01
// Node.js stdlib ONLY — no dependencies.
// POST /screen  { "contract": "0x..." }  -> JSON verdict + evidence
// GET  /screen?contract=0x...            -> same (handy for demo links)
// GET  /health, GET /  (landing page + tiny demo form)
//
// Data sources (ALL public, no keys, no sign-in):
//   - Sourcify v2 API  https://sourcify.dev/server/v2/contract/56/<addr>
//   - BSC public RPC   https://bsc-dataseed.binance.org/ (fallback bsc-dataseed1)
// Nothing is written on-chain. No wallet, no signing, no funds move.

'use strict';

const http = require('node:http');

const PORT = Number(process.env.PORT) || 8080;
const HOST = '0.0.0.0';
const VERSION = '1.0.0';
const CHAIN_ID = 56;
const CHAIN_NAME = 'BNB Smart Chain (BSC)';

const RPC_URLS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.binance.org/',
];
const SOURCIFY_BASE = 'https://sourcify.dev/server/v2/contract/56/';
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Well-known 4-byte selectors (standard, no keccak needed).
const SEL = {
  owner: '0x8da5cb5b',        // owner()
  paused: '0x5c975abb',       // paused()
  name: '0x06fdde03',         // name()
  symbol: '0x95d89b41',       // symbol()
  decimals: '0x313ce567',     // decimals()
  totalSupply: '0x18160ddd',  // totalSupply()
  supportsInterface: '0x01ffc9a7', // supportsInterface(bytes4)
};
const IFACE = { ERC721: '80ac58cd', ERC1155: 'd9b67a26' };
// EIP-1967 slots
const SLOT_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const SLOT_BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const cache = new Map(); // address -> { ts, body }

// ---------------------------------------------------------------- helpers
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

async function rpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let lastErr = null;
  for (const url of RPC_URLS) {
    try {
      const { status, json } = await fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (status === 200 && json && !json.error && typeof json.result === 'string') {
        return json.result;
      }
      lastErr = new Error(`RPC ${url} -> HTTP ${status} ${JSON.stringify(json && json.error ? json.error : json).slice(0, 120)}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all BSC RPC endpoints failed');
}

// eth_call that returns null on revert / missing function (never throws).
async function tryCall(to, data) {
  try {
    const result = await rpc('eth_call', [{ to, data }, 'latest']);
    if (!result || result === '0x' || result.length < 10) return null;
    return result;
  } catch {
    return null;
  }
}

function decodeAddress(word) {
  if (!word || word.length < 66) return null;
  const addr = '0x' + word.slice(-40);
  return addr.toLowerCase() === ZERO_ADDR ? null : addr;
}

function decodeUint(word) {
  if (!word || word.length < 66) return null;
  try { return BigInt(word).toString(10); } catch { return null; }
}

function decodeBool(word) {
  if (!word || word.length < 66) return null;
  return word.slice(-1) === '1';
}

function decodeString(hex) {
  // ABI-encoded string: [offset 32B][length 32B][utf8 bytes...]
  try {
    if (!hex || hex.length < 130) return null;
    const len = Number(BigInt('0x' + hex.slice(66, 130)));
    if (!Number.isFinite(len) || len <= 0 || len > 4096) return null;
    const bytes = Buffer.from(hex.slice(130, 130 + len * 2), 'hex');
    return bytes.toString('utf8').replace(/\0/g, '').trim() || null;
  } catch {
    return null;
  }
}

function isAddress(v) {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
}

function checksumish(addr) {
  return addr; // keep user-supplied casing; lowercase for lookups
}

// ---------------------------------------------------------------- Sourcify
async function sourcifyStatus(addr) {
  const { status, json } = await fetchJson(
    `${SOURCIFY_BASE}${addr}?fields=creationMatch,runtimeMatch,verifiedAt`
  );
  if (status === 404) return { status: 'unverified', creationMatch: null, runtimeMatch: null, verifiedAt: null };
  if (status !== 200 || !json) throw new Error(`Sourcify HTTP ${status}`);
  const match = json.match || json.creationMatch || json.runtimeMatch || null;
  // v2 values: "exact_match" | "match" (partial) | null
  const norm = match === 'exact_match' ? 'exact_match'
    : match === 'match' ? 'partial_match'
    : 'unverified';
  return {
    status: norm,
    creationMatch: json.creationMatch || null,
    runtimeMatch: json.runtimeMatch || null,
    verifiedAt: json.verifiedAt || null,
  };
}

async function sourcifyAbiAndSources(addr) {
  const out = { abiFunctions: [], projectSources: [], sourceFlags: [] };
  try {
    const { status, json } = await fetchJson(`${SOURCIFY_BASE}${addr}?fields=abi,sources`);
    if (status !== 200 || !json) return out;
    if (Array.isArray(json.abi)) {
      out.abiFunctions = json.abi
        .filter((e) => e && e.type === 'function')
        .map((e) => e.name)
        .filter(Boolean);
      out.abiFunctions = [...new Set(out.abiFunctions)].sort();
    }
    const sources = json.sources || {};
    // Only the project's own files — skip vendored libraries (@openzeppelin etc.)
    // so keyword hits reflect the project's code, not its dependencies.
    const projectFiles = Object.keys(sources).filter(
      (f) => !f.startsWith('@') && !f.includes('node_modules') && !f.includes('/lib/')
    );
    const code = projectFiles.map((f) => sources[f].content || '').join('\n');
    out.projectSources = projectFiles;
    const flags = [];
    const has = (re) => re.test(code);
    if (has(/\bsetTax\b|\bsetBuyTax\b|\bsetSellTax\b|\bsetFee\b|\bsetFees\b|\bsetTransferTax\b/)) flags.push('tax_or_fee_setter');
    if (has(/\bblacklist\b/i)) flags.push('blacklist');
    if (has(/\bupgradeTo\b|\bupgradeToAndCall\b/)) flags.push('upgrade_function');
    if (has(/\bselfdestruct\b/)) flags.push('selfdestruct');
    if (has(/\bdelegatecall\b/)) flags.push('delegatecall');
    if (has(/\bonlyOwner\b/) && has(/\bfunction\s+mint\b/)) flags.push('owner_controlled_mint');
    if (has(/\bfunction\s+pause\b|\bfunction\s+pauseMint\b/)) flags.push('pause_function');
    if (has(/\brenounceOwnership\b/)) flags.push('renounce_function_exists');
    out.sourceFlags = flags;
    return out;
  } catch {
    return out;
  }
}

// ---------------------------------------------------------------- screening
async function screenContract(rawAddr) {
  const started = Date.now();
  const address = rawAddr;
  const checks = {
    isContract: null,
    bytecodeBytes: null,
    verification: null,
    proxy: { isProxy: false, kind: null, implementation: null, implementationVerification: null },
    tokenType: [],
    owner: null,
    paused: null,
    onChainReads: {},
    sourceScan: { scanned: false, projectFiles: 0, flags: [] },
    abiFunctions: [],
  };
  const reasons = [];
  let score = 100;

  const deduct = (pts, reason) => {
    score -= pts;
    reasons.push(reason);
  };

  // 1. Is there code at the address?
  const code = await rpc('eth_getCode', [address, 'latest']);
  const bytecodeBytes = code && code !== '0x' ? (code.length - 2) / 2 : 0;
  checks.bytecodeBytes = bytecodeBytes;
  checks.isContract = bytecodeBytes > 0;
  if (!checks.isContract) {
    return {
      ok: true,
      contract: address,
      chain: CHAIN_NAME,
      chainId: CHAIN_ID,
      checkedAt: new Date().toISOString(),
      verdict: 'BUKAN_KONTRAK',
      score: null,
      summary: 'Alamat ini bukan kontrak — tidak ada bytecode (kemungkinan EOA / wallet biasa).',
      checks,
      reasons: ['Tidak ada bytecode di alamat ini (eth_getCode kosong).'],
      evidence: {
        sourcify: `https://repo.sourcify.dev/contracts/${CHAIN_ID}/${address}`,
        bscscan: `https://bscscan.com/address/${address}`,
      },
      latencyMs: Date.now() - started,
      disclaimer: 'Screening aid only — bukan nasihat keuangan. Selalu verifikasi sendiri sebelum mint.',
    };
  }

  // 2. Sourcify verification status
  const verif = await sourcifyStatus(address);
  checks.verification = verif;
  if (verif.status === 'unverified') {
    deduct(50, 'Kontrak TIDAK TERVERIFIKASI di Sourcify — source code tidak bisa diperiksa publik.');
  } else if (verif.status === 'partial_match') {
    deduct(15, 'Verifikasi Sourcify hanya PARTIAL match — sebagian source/metadata tidak cocok dengan bytecode on-chain.');
  } else {
    reasons.push('Terverifikasi Sourcify EXACT MATCH — source code cocok dengan bytecode on-chain.');
  }

  // 3. Proxy detection (EIP-1967 implementation + beacon slots)
  const implSlot = await rpc('eth_getStorageAt', [address, SLOT_IMPL, 'latest']);
  const beaconSlot = await rpc('eth_getStorageAt', [address, SLOT_BEACON, 'latest']);
  const implFromSlot = (v) => (v && v !== '0x' + '0'.repeat(64) ? decodeAddress(v) : null);
  const impl = implFromSlot(implSlot);
  const beacon = implFromSlot(beaconSlot);
  if (impl) {
    checks.proxy.isProxy = true;
    checks.proxy.kind = 'EIP-1967 proxy';
    checks.proxy.implementation = impl;
    deduct(10, `Kontrak adalah EIP-1967 PROXY — logika hidup di implementation ${impl}, bisa diganti lewat upgrade.`);
    const implVerif = await sourcifyStatus(impl);
    checks.proxy.implementationVerification = implVerif;
    if (implVerif.status === 'unverified') {
      deduct(35, `Implementation ${impl} TIDAK TERVERIFIKASI — kode yang benar-benar dieksekusi tidak bisa diperiksa.`);
    } else if (implVerif.status === 'partial_match') {
      deduct(10, `Implementation ${impl} hanya PARTIAL match di Sourcify.`);
    } else {
      reasons.push(`Implementation ${impl} terverifikasi Sourcify exact match.`);
    }
  } else if (beacon) {
    checks.proxy.isProxy = true;
    checks.proxy.kind = 'EIP-1967 beacon proxy';
    checks.proxy.implementation = `beacon:${beacon}`;
    deduct(10, `Kontrak adalah BEACON PROXY (beacon ${beacon}) — implementation bisa diganti pemilik beacon.`);
  }

  // 4. Token type detection
  const erc721 = await tryCall(address, SEL.supportsInterface + IFACE.ERC721 + '0'.repeat(56));
  const erc1155 = await tryCall(address, SEL.supportsInterface + IFACE.ERC1155 + '0'.repeat(56));
  const supplyRaw = await tryCall(address, SEL.totalSupply);
  if (decodeBool(erc721)) checks.tokenType.push('ERC721');
  if (decodeBool(erc1155)) checks.tokenType.push('ERC1155');
  if (supplyRaw !== null && checks.tokenType.length === 0) checks.tokenType.push('ERC20-like');
  if (checks.tokenType.length === 0) checks.tokenType.push('unknown / custom');

  // 5. Owner / paused / basic metadata via standard selectors
  const ownerRaw = await tryCall(address, SEL.owner);
  const owner = decodeAddress(ownerRaw);
  checks.owner = owner;
  if (owner) {
    deduct(5, `Ada owner aktif (${owner}) — owner punya kontrol atas kontrak (bukan renounced).`);
  } else {
    reasons.push('Tidak ada owner() yang terbaca — tidak ada kontrol owner tunggal yang terdeteksi.');
  }

  const pausedRaw = await tryCall(address, SEL.paused);
  const paused = decodeBool(pausedRaw);
  checks.paused = paused;
  if (paused === true) deduct(5, 'Kontrak sedang PAUSED (paused() = true).');

  const reads = checks.onChainReads;
  const name = decodeString(await tryCall(address, SEL.name));
  const symbol = decodeString(await tryCall(address, SEL.symbol));
  const decimals = decodeUint(await tryCall(address, SEL.decimals));
  if (name) reads.name = name;
  if (symbol) reads.symbol = symbol;
  if (decimals !== null) reads.decimals = decimals;
  if (supplyRaw !== null) {
    const s = decodeUint(supplyRaw);
    if (s !== null) reads.totalSupply = s;
  }

  // 6. If verified: ABI function list + project source keyword scan
  if (verif.status !== 'unverified') {
    const { abiFunctions, projectSources, sourceFlags } = await sourcifyAbiAndSources(address);
    checks.abiFunctions = abiFunctions;
    checks.sourceScan = { scanned: true, projectFiles: projectSources.length, flags: sourceFlags };
    const flagNotes = {
      tax_or_fee_setter: ['TAX/FEE SETTER terdeteksi di source (setTax/setFee/dll) — pajak transfer bisa diubah owner.', 15],
      blacklist: ['Fungsi BLACKLIST terdeteksi — alamat bisa diblokir dari transfer.', 10],
      upgrade_function: ['Fungsi UPGRADE (upgradeTo) terdeteksi di source — kontrak bisa diganti logikanya.', 10],
      selfdestruct: ['SELFDESTRUCT terdeteksi di source — kontrak bisa dimusnahkan owner.', 20],
      delegatecall: ['DELEGATECALL terdeteksi di source proyek — risiko eksekusi kode eksternal.', 10],
      owner_controlled_mint: ['Mint dikontrol owner (onlyOwner + mint) — supply baru bergantung pada owner.', 10],
      pause_function: ['Fungsi PAUSE terdeteksi — owner bisa menghentikan fungsi kontrak.', 0],
      renounce_function_exists: ['Fungsi renounceOwnership tersedia (belum tentu sudah dipanggil).', 0],
    };
    for (const f of sourceFlags) {
      const [note, pts] = flagNotes[f] || [f, 0];
      if (pts > 0) deduct(pts, note);
      else reasons.push(note);
    }
  } else {
    reasons.push('Source scan dilewati — kontrak unverified, tidak ada source publik untuk dipindai.');
  }

  // 7. Verdict
  score = Math.max(0, Math.min(100, score));
  let verdict;
  let summary;
  if (score >= 80) {
    verdict = 'AMAN';
    summary = 'Tidak ada red flag besar yang terdeteksi dari data publik. Tetap DYOR — screening tidak menjamin keamanan.';
  } else if (score >= 50) {
    verdict = 'HATI-HATI';
    summary = 'Ada beberapa hal yang perlu diperiksa manual sebelum berinteraksi — lihat daftar alasan.';
  } else {
    verdict = 'BAHAYA';
    summary = 'Red flag serius terdeteksi (unverified dan/atau upgrade risk dan/atau kontrol owner). Jangan mint/interaksi tanpa audit mandiri.';
  }

  return {
    ok: true,
    contract: address,
    chain: CHAIN_NAME,
    chainId: CHAIN_ID,
    checkedAt: new Date().toISOString(),
    verdict,
    score,
    summary,
    checks,
    reasons,
    evidence: {
      sourcify: `https://repo.sourcify.dev/contracts/${CHAIN_ID}/${address}`,
      bscscan: `https://bscscan.com/address/${address}#code`,
      ...(checks.proxy.implementation && checks.proxy.implementation.startsWith('0x')
        ? { implementationSourcify: `https://repo.sourcify.dev/contracts/${CHAIN_ID}/${checks.proxy.implementation}` }
        : {}),
    },
    latencyMs: Date.now() - started,
    disclaimer: 'Screening aid only — bukan nasihat keuangan. Verdict dihitung dari data publik (Sourcify + BSC RPC) dan bisa berubah; selalu verifikasi sendiri sebelum mint.',
  };
}

// ---------------------------------------------------------------- HTTP
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 4096) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleScreen(req, res, contract) {
  if (!contract || typeof contract !== 'string') {
    return sendJson(res, 400, { ok: false, error: 'missing_contract', message: 'Kirim {"contract": "0x..."} (POST) atau ?contract=0x... (GET).' });
  }
  const addr = contract.trim();
  if (!isAddress(addr)) {
    return sendJson(res, 400, { ok: false, error: 'invalid_address', message: 'Alamat kontrak harus format 0x + 40 karakter hex.' });
  }
  const key = addr.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    const body = { ...cached.body, cached: true };
    return sendJson(res, 200, body);
  }
  try {
    const result = await screenContract(checksumish(addr));
    result.cached = false;
    cache.set(key, { ts: Date.now(), body: result });
    return sendJson(res, 200, result);
  } catch (e) {
    console.error('screen error', addr, e.message);
    return sendJson(res, 502, { ok: false, error: 'upstream_error', message: 'Gagal membaca data publik (Sourcify / BSC RPC). Coba lagi sebentar lagi.' });
  }
}

const LANDING = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Free-Mint Safety Screener — BSC</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6}
code{background:#f0f0f0;padding:2px 6px;border-radius:4px}input{width:100%;padding:10px;font-size:15px}
button{padding:10px 18px;font-size:15px;cursor:pointer;margin-top:8px}pre{background:#111;color:#ddd;padding:14px;overflow:auto;border-radius:8px;font-size:13px}</style></head>
<body>
<h1>🛡️ Free-Mint Safety Screener</h1>
<p>Agent publik: tempel alamat kontrak <b>BNB Smart Chain</b>, dapatkan verdict keamanan
(<b>AMAN / HATI-HATI / BAHAYA</b>) dari data publik — status verifikasi Sourcify, proxy/upgrade risk,
owner controls, dan scan source code. Tanpa wallet, tanpa signing, tanpa biaya.</p>
<p><b>API:</b> <code>POST /screen</code> dengan body <code>{"contract": "0x..."}</code> &nbsp;·&nbsp;
<code>GET /screen?contract=0x...</code> &nbsp;·&nbsp; <code>GET /health</code></p>
<form id="f"><input id="addr" placeholder="0x... alamat kontrak BSC" spellcheck="false">
<br><button type="submit">Screen kontrak</button></form>
<pre id="out">Contoh: 0x19f125dA1985033f102CA7746Cbd1F6f512CFACd (AgentCards, verified)</pre>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = document.getElementById('out');
  const contract = document.getElementById('addr').value.trim();
  out.textContent = 'Memeriksa ' + contract + ' ...';
  try {
    const r = await fetch('/screen', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ contract }) });
    out.textContent = JSON.stringify(await r.json(), null, 2);
  } catch (err) { out.textContent = 'Error: ' + err.message; }
});
</script>
<p><small>Wildcard track — Agent Games zkVerify Season 01. Data: Sourcify + BSC public RPC.
Screening aid only, bukan nasihat keuangan.</small></p>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'free-mint-safety-screener', version: VERSION, chain: 'BSC (56)', ts: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const body = LANDING;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      return res.end(body);
    }
    if (req.method === 'GET' && url.pathname === '/screen') {
      // await (bukan return langsung): finally{} di bawah baru jalan setelah
      // screening selesai, jadi log timing mencatat durasi sebenarnya.
      await handleScreen(req, res, url.searchParams.get('contract'));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/screen') {
      let parsed = null;
      try { parsed = JSON.parse(await readBody(req)); } catch {
        return sendJson(res, 400, { ok: false, error: 'invalid_json', message: 'Body harus JSON valid: {"contract": "0x..."}' });
      }
      await handleScreen(req, res, parsed && parsed.contract);
      return;
    }
    return sendJson(res, 404, { ok: false, error: 'not_found', message: 'Endpoint: GET /health, GET /, GET/POST /screen' });
  } catch (e) {
    console.error('handler error', e);
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  } finally {
    console.log(`${req.method} ${req.url} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`free-mint-safety-screener v${VERSION} listening on ${HOST}:${PORT}`);
});
