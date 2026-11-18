# Demo — Free-Mint Safety Screener

Hasil tes lokal nyata, **15 Nov 2026 ~20:39 WIB** (`bash test.sh`, server di `:8080`).
Semua alamat adalah kontrak BSC publik yang sudah dikenal — bukan karangan.
Respons mentah lengkap tersimpan di `demo/` (7 file JSON).

## 1. AgentCards — AMAN (85)

Kontrak NFT Agent Cards yang sudah dimint Irfan sendiri — terverifikasi exact match.

```bash
curl -X POST http://localhost:8080/screen \
  -H 'content-type: application/json' \
  -d '{"contract": "0x19f125dA1985033f102CA7746Cbd1F6f512CFACd"}'
```

```json
{
  "ok": true,
  "contract": "0x19f125dA1985033f102CA7746Cbd1F6f512CFACd",
  "chain": "BNB Smart Chain (BSC)", "chainId": 56,
  "checkedAt": "2026-11-15T13:39:46.354Z",
  "verdict": "AMAN",
  "score": 85,
  "summary": "Tidak ada red flag besar yang terdeteksi dari data publik. Tetap DYOR — screening tidak menjamin keamanan.",
  "checks": {
    "isContract": true, "bytecodeBytes": 21703,
    "verification": { "status": "exact_match", "creationMatch": "exact_match",
                      "runtimeMatch": "exact_match", "verifiedAt": "2026-11-03T14:00:23Z" },
    "proxy": { "isProxy": false, "kind": null, "implementation": null,
               "implementationVerification": null },
    "tokenType": ["ERC721"],
    "owner": "0x41d2ba8ac1d6a765f92664db9535f40dfd8b0a99",
    "paused": null,
    "onChainReads": { "name": "Agent Cards", "symbol": "ACARD", "totalSupply": "8318" },
    "sourceScan": { "scanned": true, "projectFiles": 2,
                    "flags": ["owner_controlled_mint", "pause_function", "renounce_function_exists"] },
    "abiFunctions": ["mint", "mintOpen", "priceOf", "marketFeeBps", "owner",
                     "pauseMint", "renounceOwnership", "transferOwnership", "... (81 total)"]
  },
  "reasons": [
    "Terverifikasi Sourcify EXACT MATCH — source code cocok dengan bytecode on-chain.",
    "Ada owner aktif (0x41d2ba8ac1d6a765f92664db9535f40dfd8b0a99) — owner punya kontrol atas kontrak (bukan renounced).",
    "Mint dikontrol owner (onlyOwner + mint) — supply baru bergantung pada owner.",
    "Fungsi PAUSE terdeteksi — owner bisa menghentikan fungsi kontrak.",
    "Fungsi renounceOwnership tersedia (belum tentu sudah dipanggil)."
  ],
  "evidence": {
    "sourcify": "https://repo.sourcify.dev/contracts/56/0x19f125dA1985033f102CA7746Cbd1F6f512CFACd",
    "bscscan": "https://bscscan.com/address/0x19f125dA1985033f102CA7746Cbd1F6f512CFACd#code"
  },
  "latencyMs": 2263
}
```

Catatan: verdict AMAN tapi tetap jujur soal nuansa — owner aktif dan mint
dikontrol owner membuat skor 85, bukan 100.

## 2. PIPO NFT — BAHAYA (45)

Kontrak NFT PIPO yang sudah dimint Irfan — **unverified** di Sourcify.

```bash
curl -X POST http://localhost:8080/screen \
  -H 'content-type: application/json' \
  -d '{"contract": "0xd4837fc615ce5cfc75c2d3f10617fd8ded08e412"}'
```

```json
{
  "verdict": "BAHAYA", "score": 45,
  "summary": "Red flag serius terdeteksi (unverified dan/atau upgrade risk dan/atau kontrol owner). Jangan mint/interaksi tanpa audit mandiri.",
  "checks": {
    "isContract": true, "bytecodeBytes": 7450,
    "verification": { "status": "unverified", "creationMatch": null,
                      "runtimeMatch": null, "verifiedAt": null },
    "proxy": { "isProxy": false },
    "tokenType": ["ERC721"],
    "owner": "0xd51a4ef6ee95c68039ca29c823d9dd6d8ed60e65",
    "onChainReads": { "name": "PIPO", "symbol": "PIPO" },
    "sourceScan": { "scanned": false, "projectFiles": 0, "flags": [] }
  },
  "reasons": [
    "Kontrak TIDAK TERVERIFIKASI di Sourcify — source code tidak bisa diperiksa publik.",
    "Ada owner aktif (0xd51a4ef6ee95c68039ca29c823d9dd6d8ed60e65) — owner punya kontrol atas kontrak (bukan renounced).",
    "Source scan dilewati — kontrak unverified, tidak ada source publik untuk dipindai."
  ],
  "latencyMs": 2005
}
```

## 3. BAGENT mint proxy — BAHAYA (35)

Proxy mint bagent.club. **Temuan live saat tes:** implementation di balik proxy
sekarang `0xd5befa112ac8e523d8d18cf0e893fd9eca548da7` — **sudah berganti 3 kali**
(11 Nov: `0x4a2af5…`, 14 Nov: `0xe4ee53…`, 15 Nov: `0xd5befa…`), dan ketiganya
unverified. Ini persis risiko proxy yang dirancang untuk ditangkap agent ini.

```bash
curl -X POST http://localhost:8080/screen \
  -H 'content-type: application/json' \
  -d '{"contract": "0x9CA1A3eeA74829aA5011c56386b226DB472D0F4f"}'
```

```json
{
  "verdict": "BAHAYA", "score": 35,
  "checks": {
    "isContract": true, "bytecodeBytes": 134,
    "verification": { "status": "partial_match", "creationMatch": null,
                      "runtimeMatch": "match", "verifiedAt": "2026-11-09T12:58:34Z" },
    "proxy": { "isProxy": true, "kind": "EIP-1967 proxy",
               "implementation": "0xd5befa112ac8e523d8d18cf0e893fd9eca548da7",
               "implementationVerification": { "status": "unverified" } },
    "tokenType": ["unknown / custom"],
    "owner": "0xa2c707bd2f004ec11616efdf6ab2de7324d97d19"
  },
  "reasons": [
    "Verifikasi Sourcify hanya PARTIAL match — sebagian source/metadata tidak cocok dengan bytecode on-chain.",
    "Kontrak adalah EIP-1967 PROXY — logika hidup di implementation 0xd5befa112ac8e523d8d18cf0e893fd9eca548da7, bisa diganti lewat upgrade.",
    "Implementation 0xd5befa112ac8e523d8d18cf0e893fd9eca548da7 TIDAK TERVERIFIKASI — kode yang benar-benar dieksekusi tidak bisa diperiksa.",
    "Ada owner aktif (0xa2c707bd2f004ec11616efdf6ab2de7324d97d19) — owner punya kontrol atas kontrak (bukan renounced)."
  ],
  "evidence": {
    "sourcify": "https://repo.sourcify.dev/contracts/56/0x9CA1A3eeA74829aA5011c56386b226DB472D0F4f",
    "bscscan": "https://bscscan.com/address/0x9CA1A3eeA74829aA5011c56386b226DB472D0F4f#code",
    "implementationSourcify": "https://repo.sourcify.dev/contracts/56/0xd5befa112ac8e523d8d18cf0e893fd9eca548da7"
  },
  "latencyMs": 3860
}
```

## 4. WBNB — AMAN (85)

Kontrol positif: token besar yang dikenal, partial match, tanpa owner.

```bash
curl "http://localhost:8080/screen?contract=0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
```

```json
{
  "verdict": "AMAN", "score": 85,
  "checks": {
    "isContract": true, "bytecodeBytes": 3124,
    "verification": { "status": "partial_match",
                      "verifiedAt": "2024-08-08T13:04:34Z" },
    "proxy": { "isProxy": false },
    "tokenType": ["ERC20-like"],
    "owner": null,
    "onChainReads": { "name": "Wrapped BNB", "symbol": "WBNB", "decimals": "18",
                      "totalSupply": "1563221117792396248850357" },
    "sourceScan": { "scanned": true, "projectFiles": 1, "flags": [] }
  },
  "reasons": [
    "Verifikasi Sourcify hanya PARTIAL match — sebagian source/metadata tidak cocok dengan bytecode on-chain.",
    "Tidak ada owner() yang terbaca — tidak ada kontrol owner tunggal yang terdeteksi."
  ],
  "latencyMs": 3048
}
```

## 5. EOA (bukan kontrak) — BUKAN_KONTRAK

```bash
curl -X POST http://localhost:8080/screen \
  -H 'content-type: application/json' \
  -d '{"contract": "0x8F5eeC7DCe8E7A58cA3e236BBCBC6a924449c2C4"}'
```

```json
{
  "verdict": "BUKAN_KONTRAK", "score": null,
  "summary": "Alamat ini bukan kontrak — tidak ada bytecode (kemungkinan EOA / wallet biasa).",
  "checks": { "isContract": false, "bytecodeBytes": 0 },
  "latencyMs": 112
}
```

## 6. Input invalid — HTTP 400

```bash
curl -X POST http://localhost:8080/screen \
  -H 'content-type: application/json' -d '{"contract": "0x1234"}'
```

```json
{ "ok": false, "error": "invalid_address",
  "message": "Alamat kontrak harus format 0x + 40 karakter hex." }
```

## Ringkasan tes

| # | Kasus | Verdict | Skor | Latensi |
|---|---|---|---|---|
| 1 | AgentCards (exact match, ERC721) | AMAN | 85 | ~2,3 dtk |
| 2 | PIPO NFT (unverified) | BAHAYA | 45 | ~2,0 dtk |
| 3 | BAGENT proxy (impl unverified) | BAHAYA | 35 | ~3,9 dtk |
| 4 | WBNB (partial, tanpa owner) | AMAN | 85 | ~3,0 dtk |
| 5 | EOA | BUKAN_KONTRAK | — | ~0,1 dtk |
| 6 | Input invalid | HTTP 400 | — | <5 ms |
| 7 | `GET /health` | OK | — | <10 ms |

Respons kedua untuk alamat yang sama dijawab dari cache in-memory (<5 ms,
field `"cached": true`). Semua verdict stabil di dua run tes yang terpisah.
