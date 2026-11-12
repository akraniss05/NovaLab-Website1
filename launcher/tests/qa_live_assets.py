"""Read-only live catalog/install-asset audit. No user accounts or DB mutation."""
import hashlib,io,json,re,urllib.request,urllib.error,zipfile
BASE="https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/"
MAX_DOWNLOAD=15*1024*1024
for endpoint in ["novalab-launcher-api/catalog","novalab-studio-api/catalog"]:
 with urllib.request.urlopen(BASE+endpoint,timeout=25) as response:
  payload=json.load(response)
 assert isinstance(payload.get("games"),list),endpoint
 for game in payload["games"]:
  rel=game.get("release")
  if not rel:continue
  ident=game["id"]
  url=rel.get("url","")
  digest=rel.get("sha256","")
  entry=rel.get("entry","")
  assert re.fullmatch(r"[a-f0-9]{64}",digest),f"{ident} missing SHA-256"
  assert url.startswith("https://"),f"{ident} not HTTPS"
  assert entry and not entry.startswith("/") and ".." not in entry.split("/"),f"{ident} invalid entry"
  request=urllib.request.Request(url,method="HEAD",headers={"User-Agent":"NovaLab-QA/1"})
  with urllib.request.urlopen(request,timeout=45) as response:
   status=response.status
   length=int(response.headers.get("Content-Length","0") or "0")
   assert status==200,f"{ident} asset HEAD returned {status}"
  declared=int(rel.get("size") or 0)
  if declared and length and declared!=length:
   raise AssertionError(f"{ident} declared {declared} bytes but remote asset is {length}")
  should_download=(declared or length) and (declared or length)<=MAX_DOWNLOAD
  if should_download:
   with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"NovaLab-QA/1"}),timeout=90) as response:
    raw=response.read(MAX_DOWNLOAD+1)
   assert len(raw)<=MAX_DOWNLOAD,f"{ident} payload exceeded test safety limit"
   assert hashlib.sha256(raw).hexdigest()==digest,f"{ident} published SHA-256 does NOT match downloaded ZIP"
   with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    assert archive.testzip() is None,f"{ident} ZIP file CRC failed"
    assert entry in archive.namelist(),f"{ident} ZIP missing expected launch file: {entry}"
    for filename in archive.namelist():
     assert not filename.startswith("/") and ".." not in filename.replace("\\","/").split("/"),f"{ident} unsafe ZIP entry"
   print(f"PASS {ident}: live ZIP {len(raw)} bytes, SHA-256, CRC and entry {entry}")
  else:
   print(f"PASS {ident}: live downloadable URL reachable, {declared or length} bytes (large archive body not downloaded)")
print("PASS public game catalog asset audit")
