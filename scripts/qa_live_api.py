"""Read-only live smoke checks for NovaLab Website API; never logs in or modifies data."""
import json
import re
from urllib.request import Request,urlopen
from urllib.error import HTTPError

BASE="https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/novalab-site-api"
ORIGIN="https://akraniss05.github.io"

def request(method,path,body=None,origin=ORIGIN):
 headers={"Origin":origin}
 if body is not None:
  headers["Content-Type"]="application/json"
  body=json.dumps(body).encode("utf-8")
 req=Request(BASE+path, data=body, headers=headers, method=method)
 try:
  with urlopen(req,timeout=25) as response:
   return response.status,response.headers,json.loads(response.read())
 except HTTPError as error:
  return error.code,error.headers,json.loads(error.read())

status,headers,health=request("GET","/health")
assert status==200 and health.get("status")=="ok",f"Website API health failed: {status}, {health}"
assert headers.get("Access-Control-Allow-Origin")==ORIGIN
status,headers,listing=request("GET","/projects")
assert status==200 and isinstance(listing.get("projects"),list),f"Public projects unavailable: {status}"
assert re.fullmatch(r"[0-9a-f]{64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}",listing.get("revision",""),re.I)
ids=[p.get("id") for p in listing["projects"]]
assert len(ids)==len(set(ids)) and all(p.get("title") and p.get("summary") for p in listing["projects"])
assert headers.get("Cache-Control")=="no-store"
status,_,denied=request("PUT","/projects",{"projects":[],"revision":listing["revision"]})
assert status==401,f"SECURITY: unauthenticated write was not denied: {status} {denied}"
status,_,denied=request("POST","/media",{"mime":"image/png","base64":"AAAA"})
assert status==401,f"SECURITY: unauthenticated media upload was not denied: {status} {denied}"
status,_,denied=request("GET","/health",origin="https://untrusted.example")
assert status==403,f"SECURITY: disallowed Origin was not blocked: {status} {denied}"
print(f"OK: live health, {len(ids)} projects, revisions, CORS, no anonymous writes/uploads")
