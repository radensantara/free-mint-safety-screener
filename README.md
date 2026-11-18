# 🛡️ Free-Mint Safety Screener

**Wildcard track — Agent Games zkVerify Season 01**

Agent publik yang memeriksa keamanan kontrak **BNB Smart Chain** sebelum kamu mint:
tempel alamat kontrak → dapat verdict **AMAN / HATI-HATI / BAHAYA** + bukti yang bisa
dicek siapa pun. Tanpa wallet, tanpa signing, tanpa biaya, tanpa referral.

## Masalah yang diselesaikan

Free mint di BSC terlihat gratis, tapi risikonya nyata dan sudah kejadian:

- **Kontrak unverified** — source code tidak bisa diperiksa (contoh nyata: PIPO NFT).
- **Proxy yang implementation-nya diganti diam-diam** — BAGENT: implementation di balik
  proxy sudah berganti **3 kali** (Nov 2026), dan yang terbaru pun unverified.
- **Situs yang bilang "free" padahal tidak** — BAO: `freeShareAvailable: true` di
  website, tapi share pertama ternyata 0,0012 BNB on-chain.
- **Scam terang-terangan** — SAFU (dihentikan setelah indikasi scam).

Korban tipikalnya adalah pemburu free mint yang tidak sempat / tidak bisa membaca
kontrak sendiri. Agent ini mengotomatisasi screening yang selama ini dilakukan
manual: cek Sourcify, cek proxy slot, cek owner, scan source.

## Cara pakai

```bash
# Lokal
node server.js            # listen :8080 (atau $PORT)

# Screen satu kontrak
curl -X POST http://localhost:8080/screen \
  -H 'content-type: application/json' \
  -d '{"contract": "0x19f125dA1985033f102CA7746Cbd1F6f512CFACd"}'

# Atau lewat GET (cocok untuk demo link)
curl "http://localhost:8080/screen?contract=0x19f125dA1985033f102CA7746Cbd1F6f512CFACd"
```

Endpoint lain: `GET /health`, `GET /` (landing page + form demo di browser).

## Yang diperiksa (semua dari data publik)

| # | Pemeriksaan | Sumber |
|---|---|---|
| 1 | Ada bytecode? (EOA vs kontrak) | BSC RPC `eth_getCode` |
| 2 | Status verifikasi Sourcify: exact / partial / unverified | Sourcify v2 API |
| 3 | Proxy? Baca slot EIP-1967 implementation + beacon | BSC RPC `eth_getStorageAt` |
| 4 | Implementation proxy terverifikasi atau tidak | Sourcify v2 API (rekursif 1 level) |
| 5 | Jenis token: ERC721 / ERC1155 / ERC20-like | `supportsInterface` + `totalSupply()` |
| 6 | Owner aktif? Paused? Nama/symbol/decimals/supply | `eth_call` selector standar |
| 7 | Scan source proyek (bukan library): tax/fee setter, blacklist, upgrade, selfdestruct, delegatecall, owner-controlled mint, pause | Sourcify `?fields=abi,sources` |

## Rubrik skor (transparan, dihitung di `server.js`)

Mulai dari 100. Verdict: **≥80 AMAN · 50–79 HATI-HATI · <50 BAHAYA**.

| Pengurang | Poin | Alasan |
|---|---|---|
| Unverified di Sourcify | −50 | Source tidak bisa diperiksa publik |
| Partial match | −15 | Sebagian source/metadata tidak cocok |
| Proxy (EIP-1967 / beacon) | −10 | Logika bisa diganti lewat upgrade |
| Implementation proxy unverified | −35 | Kode yang dieksekusi tidak bisa diperiksa |
| Implementation proxy partial | −10 | |
| Owner aktif | −5 | Ada kontrol owner tunggal |
| Tax/fee setter di source | −15 | Pajak transfer bisa diubah owner |
| Blacklist | −10 | Alamat bisa diblokir transfer |
| Fungsi upgrade di source | −10 | |
| Selfdestruct | −20 | Kontrak bisa dimusnahkan owner |
| Delegatecall di source proyek | −10 | Eksekusi kode eksternal |
| Owner-controlled mint | −10 | Supply baru bergantung owner |
| Paused = true | −5 | |

Skor dijaga 0–100. Alamat tanpa bytecode → verdict khusus `BUKAN_KONTRAK`
(bukan skor 0 — itu EOA/wallet biasa, bukan kontrak berbahaya).

## Contoh hasil nyata

Dites lokal 15 Nov 2026 ~20:39 WIB (respons mentah di `demo/`, ringkasan di `DEMO.md`):

| Kontrak | Verdict | Skor | Kenapa |
|---|---|---|---|
| AgentCards `0x19f125…FACd` | AMAN | 85 | Exact match, ERC721 — tapi owner aktif + mint dikontrol owner |
| PIPO NFT `0xd4837f…8412` | BAHAYA | 45 | Unverified + owner aktif |
| BAGENT proxy `0x9CA1A3…0F4f` | BAHAYA | 35 | Proxy, implementation `0xd5befa…48da7` unverified (sudah ganti 3x) |
| WBNB `0xbb4CdB…095c` | AMAN | 85 | Partial match, tanpa owner |
| EOA (wallet Binance) | BUKAN_KONTRAK | — | Tidak ada bytecode |

## Arsitektur

- **Node.js stdlib saja** — tanpa dependensi (`node:http` + `fetch` global). Satu file
  `server.js`, tidak ada build step, tidak ada database.
- **Tidak ada secret** — semua data publik, tanpa API key (Sourcify + BSC public RPC).
- **Cache in-memory 5 menit** per alamat — hemat RPC, respons ulang <5 ms.
- **Fallback RPC** — `bsc-dataseed.binance.org` → `bsc-dataseed1.binance.org`.
- **Timeout 8 detik** per upstream call; gagal upstream → HTTP 502 dengan pesan jelas.
- **Tidak pernah menulis on-chain** — murni baca (read-only). Tidak ada wallet,
  tidak ada signing, tidak ada dana bergerak.

## Deploy

Repo ini self-contained: `Dockerfile` (Northflank) + `render.yaml` (Render).

- **Opsi #1 — Northflank Sandbox:** hubungkan repo → Combined service → Build:
  Dockerfile → tambah public port → URL `*.code.run` + TLS otomatis. Selalu-on,
  tanpa tidur. (Kemungkinan kartu wajib verifikasi saat signup — Irfan yang lakukan.)
- **Opsi #2 — Render Free:** hubungkan repo → Blueprint (`render.yaml`) → URL
  `*.onrender.com`. Tidur setelah 15 menit idle → **wajib keep-alive ping
  `GET /health` tiap 5 menit** dari cron terpisah.
- Detail lengkap: `../hosting/HOSTING-NOTES.md`.

## Batasan (jujur)

- **Harga mint & kuota gratis tidak dibaca generik** — nama fungsi mint/price
  berbeda tiap kontrak dan butuh ABI spesifik; agent melaporkan apa yang *bisa*
  dibaca (nama, supply, owner, paused, fee setter di source) dan tidak mengarang
  sisanya. Untuk kontrak terverifikasi, daftar fungsi ABI ditampilkan di respons
  (`checks.abiFunctions`) supaya pengguna bisa lanjut cek manual.
- **Pajak transfer tidak diukur langsung** — dideteksi lewat keberadaan fee/tax
  setter di source (kontrak terverifikasi saja). Kontrak unverified tidak bisa
  di-scan — itulah kenapa unverified langsung −50.
- **Verdict = screening aid, bukan jaminan keamanan dan bukan nasihat keuangan.**
  Setiap verdict menyertakan link bukti Sourcify + BscScan supaya siapa pun bisa
  memverifikasi ulang dalam hitungan detik.
- Hanya BSC (chain 56) untuk Season 01. Multi-chain tinggal tambah chainId +
  endpoint Sourcify/RPC — tidak ada yang mengikat ke BSC di logika skor.

## File

| File | Isi |
|---|---|
| `server.js` | Agent (stdlib only) |
| `package.json` | Metadata + `npm start` |
| `Dockerfile` | Deploy Northflank |
| `render.yaml` | Deploy Render (Blueprint) |
| `test.sh` | Tes lokal 7 kasus → `demo/` |
| `demo/` | Respons mentah hasil tes lokal |
| `DEMO.md` | Contoh request/response nyata |
| `SUBMISSION.md` | Paket submission 5 field + langkah Irfan |
| `README.md` | Dokumen ini |

## Lisensi

UNLICENSED — kode untuk kompetisi Agent Games zkVerify Season 01.
