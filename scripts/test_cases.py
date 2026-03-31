#!/usr/bin/env python3
import json
import subprocess
import sys

CASES = {
    "风云X3PLUS": {"autohome": "8089", "dongchedi": "25398"},
    "风云T11": {"autohome": "7411", "dongchedi": "9436"},
}

SCRIPT = "scripts/find_vehicle_ids.py"

failed = False
for query, expect in CASES.items():
    proc = subprocess.run([sys.executable, SCRIPT, query, "--site", "all", "--json"], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"[FAIL] {query}: script exited {proc.returncode}")
        print(proc.stderr)
        failed = True
        continue
    try:
        data = json.loads(proc.stdout)
    except Exception as e:
        print(f"[FAIL] {query}: invalid json: {e}")
        print(proc.stdout)
        failed = True
        continue
    ah = (((data.get('autohome') or {}).get('best') or {}).get('id'))
    dcd = (((data.get('dongchedi') or {}).get('best') or {}).get('id'))
    if ah != expect['autohome'] or dcd != expect['dongchedi']:
        print(f"[FAIL] {query}: expected AH={expect['autohome']} DCD={expect['dongchedi']}, got AH={ah} DCD={dcd}")
        failed = True
    else:
        print(f"[PASS] {query}: AH={ah} DCD={dcd}")

sys.exit(1 if failed else 0)
