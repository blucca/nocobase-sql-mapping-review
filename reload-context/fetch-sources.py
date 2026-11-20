"""Download the five immutable originals to a temporary directory; retain all notices."""
import base64
import json
import sys
import urllib.request
from pathlib import Path

manifest = json.loads(Path(__file__).with_name("source-files.json").read_text())
out = Path(sys.argv[1] if len(sys.argv) > 1 else "temp/reload-context-source")
out.mkdir(parents=True, exist_ok=True)
for item in manifest["files"]:
    request = urllib.request.Request(item["url"], headers={"User-Agent": "NocoBase-reload-context-review"})
    with urllib.request.urlopen(request, timeout=30) as response:
        blob = json.load(response)
    assert blob["sha"] == item["blob_sha"] and blob["encoding"] == "base64"
    (out / item["filename"]).write_bytes(base64.b64decode(blob["content"]))
    print(item["filename"])
