#!/usr/bin/env bash
# ===================================================================
#  pull_apk.sh — GitHub ki `apk` branch se nayi APK utaar kar
#                Phase2/app/ me rakh do.  (Linux / server)
#
#  APK `main` me nahi hoti (`Phase2/app/` gitignored hai), isliye
#  `git pull` se wo KABHI nahi aati.  Wo alag `apk` branch par
#  chadhti hai — laptop se `python Phase2/scripts/push_apk.py`.
#
#  Ye script:
#    • sirf `apk` branch laati hai (aapki branch/kaam ko haath nahi lagati)
#    • pehle TEMP file me utaarti hai, jaanchti hai, TAB purani ke upar
#      rakhti hai — yaani beech me kuch toota to purani APK safe rehti hai
#    • backend restart NAHI karti (zaroorat hi nahi, wo har request par
#      file disk se padhta hai)
#
#  Chalao (repo ki jad se):   ./pull_apk.sh
# ===================================================================
set -euo pipefail
cd "$(dirname "$0")"

BRANCH="apk"
DIR="Phase2/app"
APK="$DIR/maintenance.apk"
META="$DIR/version.json"

# ── purana kya hai (baad me farq dikhane ke liye) ─────────────
purana="(kuch nahi)"
if [ -f "$META" ]; then
  purana=$(python3 -c "import json;print(json.load(open('$META')).get('version','?'))" 2>/dev/null || echo "?")
fi

echo ""
echo "  abhi server par : v$purana"
echo "  GitHub se '$BRANCH' branch laa rahe hain..."

# ── sirf wahi branch laao ─────────────────────────────────────
# `fetch` working tree ko haath nahi lagata — aapka code jaisa hai waisa
# rehta hai, chahe aap kisi bhi branch par hon.
if ! git fetch origin "$BRANCH" 2>/dev/null; then
  echo "  [ERROR] '$BRANCH' branch nahi mili."
  echo "          Laptop se pehle chadhani padegi:"
  echo "            python Phase2/scripts/push_apk.py"
  exit 1
fi

# ── TEMP me utaaro (purani ko abhi haath nahi lagate) ─────────
mkdir -p "$DIR"
tmp_apk=$(mktemp "${DIR}/.apk.XXXXXX")
tmp_meta=$(mktemp "${DIR}/.meta.XXXXXX")
# kuch bhi gadbad ho to temp file peeche na chhoote
trap 'rm -f "$tmp_apk" "$tmp_meta"' EXIT

git cat-file blob "FETCH_HEAD:maintenance.apk" > "$tmp_apk"
git cat-file blob "FETCH_HEAD:version.json"   > "$tmp_meta"

# ── jaancho, phir hi purani ke upar rakho ─────────────────────
size=$(stat -c%s "$tmp_apk" 2>/dev/null || wc -c < "$tmp_apk")
if [ "$size" -lt 1000000 ]; then
  echo "  [ERROR] Jo APK aayi wo sirf $size bytes ki hai — kuch galat hai."
  echo "          Purani APK ko haath nahi lagaya."
  exit 1
fi
naya=$(python3 -c "import json;print(json.load(open('$tmp_meta'))['version'])" 2>/dev/null || echo "")
if [ -z "$naya" ]; then
  echo "  [ERROR] version.json padhi nahi ja rahi. Purani APK safe hai."
  exit 1
fi

mv -f "$tmp_apk"  "$APK"
mv -f "$tmp_meta" "$META"
chmod 644 "$APK" "$META"
trap - EXIT

echo ""
echo "  HO GAYA"
echo "     v$purana  ->  v$naya"
echo "     $APK  ($(( size / 1048576 )).$(( (size % 1048576) * 10 / 1048576 )) MB)"
echo ""
echo "  Backend restart ki zaroorat NAHI — file seedha padhi jaati hai."
echo "  Jaanch ke liye:"
echo "     curl -s http://localhost:8892/api/app/version"
echo ""
