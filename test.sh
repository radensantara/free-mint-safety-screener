#!/usr/bin/env bash
# Test lokal Free-Mint Safety Screener.
# Menjalankan server di :8080, lalu memanggil 6 kasus uji nyata dan
# menyimpan respons mentah ke demo/ (dipakai untuk DEMO.md).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p demo

node server.js > demo/server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

echo "== health =="
curl -s http://localhost:8080/health | tee demo/01-health.json; echo

# Kasus nyata (alamat publik BSC, BUKAN karangan):
# 1. AgentCards — verified exact match, ERC721
# 2. PIPO NFT — UNVERIFIED
# 3. BAGENT mint proxy — partial match proxy, implementation unverified
# 4. WBNB — partial match, ERC20, tanpa owner
# 5. EOA Irfan (wallet Binance) — bukan kontrak
# 6. Input invalid
declare -A CASES=(
  [02-agentcards]='{"contract":"0x19f125dA1985033f102CA7746Cbd1F6f512CFACd"}'
  [03-pipo-unverified]='{"contract":"0xd4837fc615ce5cfc75c2d3f10617fd8ded08e412"}'
  [04-bagent-proxy]='{"contract":"0x9CA1A3eeA74829aA5011c56386b226DB472D0F4f"}'
  [05-wbnb]='{"contract":"0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"}'
  [06-eoa]='{"contract":"0x8F5eeC7DCe8E7A58cA3e236BBCBC6a924449c2C4"}'
  [07-invalid]='{"contract":"0x1234"}'
)
for f in "${!CASES[@]}"; do
  echo "== $f =="
  curl -s -X POST http://localhost:8080/screen -H 'content-type: application/json' -d "${CASES[$f]}" | tee "demo/$f.json"; echo
done

echo "== ringkasan verdict =="
for f in demo/0*.json; do
  node -e "const j=require('./$f'); console.log('$f', '->', j.verdict ?? j.error ?? (j.ok===true?'OK':'?'), j.score ?? '', j.checks?.verification?.status ?? '', j.checks?.proxy?.isProxy ? '(proxy)' : '')" 2>/dev/null || true
done
echo "OK — semua respons mentah tersimpan di demo/"
