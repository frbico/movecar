#!/usr/bin/env bash
# Create a SQLite-consistent MoveCar data export for migration between VPSs.
set -Eeuo pipefail
OUT="${1:-$PWD/movecar-transfer.sqlite}"
[[ ! -e "$OUT" ]] || { echo "Target already exists: $OUT" >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker is required' >&2; exit 1; }
umask 077
docker exec movecar node --input-type=module -e '
import {DatabaseSync,backup} from "node:sqlite";
import fs from "node:fs";
const src="/app/data/state.sqlite",dst="/app/data/movecar-migration-export.sqlite";
if(!fs.existsSync(src))throw Error("MoveCar SQLite data is missing");
const db=new DatabaseSync(src);
try { await backup(db,dst); } finally { db.close(); }
console.log("PASS consistent SQLite export created");
'
docker cp movecar:/app/data/movecar-migration-export.sqlite "$OUT"
docker exec movecar rm -f /app/data/movecar-migration-export.sqlite
chmod 0600 "$OUT"
python3 - "$OUT" <<'PY'
import sqlite3,sys
con=sqlite3.connect(f'file:{sys.argv[1]}?mode=ro',uri=True)
try:
    assert con.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    assert con.execute('SELECT count(*) FROM sqlite_master').fetchone()[0]>0
finally:con.close()
print('PASS SQLite export integrity check')
PY
echo "Private migration file: $OUT (transfer over SSH/SCP, never commit to GitHub)"
