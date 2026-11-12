"""Read-only live API security smoke test. No accounts or games are modified."""
import json, urllib.request, urllib.error
BASE="https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/"
cases=[
 ("novalab-launcher-api/staff","GET",None),
 ("novalab-launcher-api/role","POST",{"username":"Nobody","role":"admin"}),
 ("novalab-launcher-api/staff-reset-password","POST",{"username":"Nobody","newPassword":"Unused-Test-Password123","adminPassword":"unused"}),
 ("novalab-launcher-api/upload","POST",{}),
 ("novalab-studio-api/list","GET",None),
 ("novalab-studio-api/save","POST",{"id":"community-security-probe","title":"Never created","summary":"Unauthorized request"}),
 ("novalab-studio-api/delete","POST",{"id":"community-security-probe","confirmTitle":"Never created"}),
 ("novalab-studio-api/publish","POST",{"id":"community-security-probe","visibility":"published"}),
 ("novalab-studio-api/upload-build","POST",{}),
]
for path,method,payload in cases:
 data=json.dumps(payload).encode() if payload is not None else None
 req=urllib.request.Request(BASE+path,data=data,method=method,headers={"Content-Type":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=20) as response:
   status=response.status
 except urllib.error.HTTPError as e:
  status=e.code
 except Exception as e:
  raise AssertionError(f"{path}: network failure {e}") from e
 assert status in (401,403),f"CRITICAL: anonymous {method} {path} returned {status}, expected 401 or 403"
 print(f"PASS anonymous {method} {path} denied: {status}")
for endpoint in ["novalab-launcher-api/catalog","novalab-studio-api/catalog"]:
 with urllib.request.urlopen(BASE+endpoint,timeout=20) as response:
  payload=json.loads(response.read(3_000_000).decode())
 assert isinstance(payload.get("games"),list),f"Catalog malformed: {endpoint}"
 print(f"PASS public {endpoint}: {len(payload['games'])} games")
