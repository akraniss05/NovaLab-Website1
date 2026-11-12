"""Read-only full archive audit for published large NovaLab Studio releases."""
import hashlib,io,json,os,pathlib,sys,tempfile,urllib.request,zipfile
BASE="https://ekgxotvvhkmeuxvuwbei.supabase.co/functions/v1/novalab-studio-api/catalog"
MAX_BYTES=250_000_000
MAX_FILES=3000
MAX_UNPACKED=1_000_000_000
with urllib.request.urlopen(urllib.request.Request(BASE,headers={"User-Agent":"NovaLab-Deep-QA/1"}),timeout=30) as r:
 games=json.load(r)["games"]
checked=0
for game in games:
 rel=game.get("release")
 if not rel or not rel.get("size") or rel["size"]<15*1024*1024:
  continue
 ident=game.get("id","unknown")
 print("AUDIT",ident,rel.get("version"),rel.get("size"),flush=True)
 if rel["size"]>MAX_BYTES:raise AssertionError(f"{ident}: published archive exceeds native download cap!")
 digest=hashlib.sha256()
 received=0
 with tempfile.TemporaryDirectory() as folder:
  filename=os.path.join(folder,"release.zip")
  with urllib.request.urlopen(urllib.request.Request(rel["url"],headers={"User-Agent":"NovaLab-Deep-QA/1"}),timeout=90) as response,open(filename,"wb") as file:
   while True:
    block=response.read(1024*1024)
    if not block:break
    received+=len(block)
    assert received<=MAX_BYTES,f"{ident}: archive too large"
    digest.update(block);file.write(block)
  assert received==rel["size"],f"{ident}: file size mismatch {received} != {rel['size']}"
  actual=digest.hexdigest()
  assert actual==rel["sha256"],f"{ident}: SHA-256 mismatch {actual} != {rel['sha256']}"
  with zipfile.ZipFile(filename) as archive:
   infos=archive.infolist()
   assert len(infos)<=MAX_FILES,f"{ident}: ZIP has too many entries"
   assert sum(x.file_size for x in infos)<=MAX_UNPACKED,f"{ident}: ZIP expands beyond Rust safety limit"
   names=set()
   for item in infos:
    n=item.filename
    assert n not in names,f"{ident}: duplicate ZIP filename {n}"
    names.add(n)
    path=pathlib.PurePosixPath(n)
    assert not path.is_absolute() and ".." not in path.parts and not "\\" in n and ":" not in n,f"{ident}: path traversal {n}"
    assert (item.external_attr>>16)&0o170000!=0o120000,f"{ident}: archive contains symlink {n}"
    assert item.compress_type in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED),f"{ident}: unsupported compression {n}"
   assert rel["entry"] in names,f"{ident}: expected executable '{rel['entry']}' absent"
   bad=archive.testzip()
   assert bad is None,f"{ident}: broken compressed member {bad}"
   print(f"PASS {ident}: {received:,} bytes, SHA-256, {len(infos)} ZIP members, CRC and entry {rel['entry']}",flush=True)
 checked+=1
print("PASS big release archive QA:",checked,"large published game(s)",flush=True)
