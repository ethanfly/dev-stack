import { app, BrowserWindow } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const ROUTES: { hash: string; file: string }[] = [
  { hash: "#/", file: "dashboard.png" },
  { hash: "#/php", file: "php.png" },
  { hash: "#/nodejs", file: "nodejs.png" },
  { hash: "#/go", file: "go.png" },
  { hash: "#/python", file: "python.png" },
  { hash: "#/rust", file: "rust.png" },
  { hash: "#/java", file: "java.png" },
  { hash: "#/dotnet", file: "dotnet.png" },
  { hash: "#/git", file: "git.png" },
  { hash: "#/mysql", file: "mysql.png" },
  { hash: "#/postgres", file: "postgres.png" },
  { hash: "#/nginx", file: "nginx.png" },
  { hash: "#/redis", file: "redis.png" },
  { hash: "#/mongodb", file: "mongodb.png" },
  { hash: "#/sites", file: "sites.png" },
  { hash: "#/hosts", file: "hosts.png" },
  { hash: "#/settings", file: "setting.png" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureDocScreenshots(win: BrowserWindow): Promise<void> {
  const docs = join(process.cwd(), "docs");
  if (!existsSync(docs)) {
    mkdirSync(docs, { recursive: true });
  }

  const base = (process.env.VITE_DEV_SERVER_URL || "http://localhost:5173/").replace(
    /\/?$/,
    "/",
  );

  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
  }
  win.setSize(1400, 900);
  win.show();
  win.focus();
  await sleep(2500);

  for (const route of ROUTES) {
    const url = `${base}${route.hash}`;
    console.log("[capture]", url);
    const ready = await win.webContents.executeJavaScript(`
      (async () => {
        const target = ${JSON.stringify(route.hash)};
        if (location.hash !== target) location.hash = target;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const title = document.querySelector('.content .page-title, .content .hero-title');
          const painted = !!(title && title.getBoundingClientRect().height > 8);
          if (location.hash === target && painted) return true;
          await new Promise((r) => setTimeout(r, 120));
        }
        return false;
      })()
    `);
    console.log("[capture] ready", route.hash, ready);
    await win.webContents.executeJavaScript(
      "document.documentElement.classList.add('dark'); true",
    );
    await sleep(ready ? 700 : 1800);
    const image = await win.webContents.capturePage();
    const png = image.resize({ width: 1400 }).toPNG();
    const dest = join(docs, route.file);
    writeFileSync(dest, png);
    console.log("[capture] wrote", dest, png.length);
  }

  console.log("[capture] done");
  app.quit();
}
