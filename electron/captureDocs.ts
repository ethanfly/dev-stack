import { app, BrowserWindow } from "electron";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const ROUTES: { hash: string; file: string }[] = [
  { hash: "#/", file: "dashboard.png" },
  { hash: "#/php", file: "php.png" },
  { hash: "#/mysql", file: "mysql.png" },
  { hash: "#/nginx", file: "nginx.png" },
  { hash: "#/go", file: "go.png" },
  { hash: "#/redis", file: "redis.png" },
  { hash: "#/nodejs", file: "nodejs.png" },
  { hash: "#/python", file: "python.png" },
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

  win.show();
  win.focus();
  await sleep(2000);

  for (const route of ROUTES) {
    const url = `${base}${route.hash}`;
    console.log("[capture]", url);
    await win.loadURL(url);
    await sleep(1800);
    await win.webContents.executeJavaScript(
      "document.documentElement.classList.add('dark'); true",
    );
    await sleep(250);
    const image = await win.webContents.capturePage();
    const png = image.resize({ width: 1400 }).toPNG();
    const dest = join(docs, route.file);
    writeFileSync(dest, png);
    console.log("[capture] wrote", dest, png.length);
  }

  console.log("[capture] done");
  app.quit();
}
