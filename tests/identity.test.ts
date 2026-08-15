import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { APP_NAME, APP_TAGLINE } from "../src/brand.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const OLD_FULL = "PHPer 开发环境管理器";
const OLD_FULL_NOSPACE = "PHPer开发环境管理器";
const OLD_BRAND = ">PHPer<";
const OLD_PITCH = "一站式 PHP 开发环境";

test("brand module exports a non-PHP-only product name", () => {
  assert.equal(typeof APP_NAME, "string");
  assert.ok(APP_NAME.length > 0);
  assert.doesNotMatch(APP_NAME, /PHPer/i);
  assert.doesNotMatch(APP_NAME, /PHP/i);
  assert.ok(APP_TAGLINE.includes("运行时") || APP_TAGLINE.includes("依赖"));
});

test("window title, title-bar, tray, About, and packaged names use APP_NAME", () => {
  const index = read("index.html");
  const app = read("src/App.vue");
  const settings = read("src/views/Settings.vue");
  const main = read("electron/main.ts");
  const pkg = JSON.parse(read("package.json"));
  const nsh = read("build/installer.nsh");

  assert.match(index, new RegExp(`<title>${APP_NAME}</title>`));
  assert.match(app, /import \{ APP_NAME, APP_TAGLINE \} from "\.\/brand"/);
  assert.match(app, /\{\{\s*APP_NAME\s*\}\}/);
  assert.match(settings, /import \{ APP_NAME, APP_TAGLINE \} from '@\/brand'/);
  assert.match(settings, /\{\{\s*APP_NAME\s*\}\}/);
  assert.match(main, /import \{ APP_NAME \} from "\.\.\/src\/brand"/);
  assert.match(main, /tray\.setToolTip\(APP_NAME\)/);
  assert.match(main, /title:\s*APP_NAME/);
  assert.match(main, /app\.setName\(APP_NAME\)/);

  assert.equal(pkg.build.productName, APP_NAME);
  assert.equal(pkg.build.win.executableName, APP_NAME);
  assert.equal(pkg.build.nsis.shortcutName, APP_NAME);
  assert.match(nsh, new RegExp(`DevStack\\.lnk`));
  assert.match(nsh, new RegExp(`${APP_NAME}\\.exe`));
});

test("old PHP-product identity is gone from chrome surfaces", () => {
  const surfaces = [
    "index.html",
    "src/App.vue",
    "src/views/Settings.vue",
    "src/views/Dashboard.vue",
    "electron/main.ts",
    "package.json",
  ];
  for (const rel of surfaces) {
    const text = read(rel);
    assert.doesNotMatch(text, new RegExp(OLD_FULL));
    assert.doesNotMatch(text, new RegExp(OLD_FULL_NOSPACE));
    assert.doesNotMatch(text, new RegExp(OLD_PITCH));
  }
  assert.doesNotMatch(read("src/App.vue"), new RegExp(OLD_BRAND));
});

test("icon sources are a stack mark without PHP wordmark or elephant", () => {
  const svg = read("public/icon.svg");
  assert.doesNotMatch(svg, />PHP</);
  assert.doesNotMatch(svg, /elephant/i);
  assert.ok(existsSync(join(root, "public/icon.png")));
  assert.ok(existsSync(join(root, "public/icon.ico")));
  assert.ok(existsSync(join(root, "build/icon.ico")));
  assert.ok(existsSync(join(root, "build/icon.png")));
  const chrome = read("src/App.vue") + read("src/views/Settings.vue");
  assert.match(chrome, /src="\/icon\.png"/);
});

test("shell nav still links every existing management surface", () => {
  const app = read("src/App.vue");
  const dashboard = read("src/views/Dashboard.vue");
  const routes = [
    "/",
    "/php",
    "/nodejs",
    "/go",
    "/python",
    "/rust",
    "/java",
    "/dotnet",
    "/git",
    "/mysql",
    "/postgres",
    "/nginx",
    "/redis",
    "/mongodb",
    "/sites",
    "/hosts",
    "/settings",
  ];
  for (const path of routes) {
    assert.match(app, new RegExp(`path:\\s*"${path}"`));
  }
  assert.match(app, /label:\s*"运行时"/);
  assert.match(app, /label:\s*"服务"/);
  assert.match(dashboard, /全局开发依赖/);
  assert.match(dashboard, /运行时/);
  assert.match(dashboard, /后台服务/);
});
