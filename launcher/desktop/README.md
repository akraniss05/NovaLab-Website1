# NovaLab Studios – Windows Launcher (Rust/Tauri 2)

This is the desktop wrapper for the standalone interactive browser frontend at `../index.html`.

The GitHub Actions workflow copies that self-contained HTML to `dist-web/index.html`, generates Windows icon resources, and runs `npm run build`.

On Windows with Node 22, Rust stable, and Microsoft C++ Build Tools installed:

```powershell
cd launcher/desktop
mkdir dist-web
copy ..\index.html dist-web\index.html
npm install
npm run build
```

Native actions: opt-in local .exe picker, launch only previously selected .exe files, HTTPS file downloads with progress, and external HTTPS links. The static web version does not gain access to the local OS.

**Security note:** Only launch game executables from sources you trust. Desktop installers are unsigned experimental builds.