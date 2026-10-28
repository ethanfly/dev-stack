import {
  httpExists,
  httpGetJson,
  httpGetText,
  HTTP_UA,
  mapPool,
} from "./httpClient.ts";

export const PHP_WIN_RELEASES_BASE =
  "https://downloads.php.net/~windows/releases/";

export function compareSemver(a: string, b: string): number {
  const as = a.replace(/^v/i, "").replace(/^go/i, "").split(/[.+-]/);
  const bs = b.replace(/^v/i, "").replace(/^go/i, "").split(/[.+-]/);
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const ai = parseInt(as[i] || "0", 10);
    const bi = parseInt(bs[i] || "0", 10);
    const aNum = Number.isFinite(ai) ? ai : 0;
    const bNum = Number.isFinite(bi) ? bi : 0;
    if (aNum !== bNum) return aNum - bNum;
  }
  return 0;
}

export function sortSemverDesc<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareSemver(key(b), key(a)));
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": HTTP_UA,
};

// ---------------------------------------------------------------------------
// PHP — official releases.json on downloads.php.net
// ---------------------------------------------------------------------------

export interface CatalogPhpVersion {
  version: string;
  downloadUrl: string;
  type: "nts" | "ts";
  arch: "x64";
}

interface PhpReleaseFile {
  zip?: { path?: string };
}

export function parsePhpReleasesJson(json: Record<string, any>): CatalogPhpVersion[] {
  const versions: CatalogPhpVersion[] = [];
  for (const info of Object.values(json || {})) {
    if (!info || typeof info !== "object") continue;
    const version = String((info as any).version || "");
    // 允许打包修订后缀，如 8.4.27-1（官方 Windows 包 repack 时会出现）
    if (!/^\d+\.\d+\.\d+(?:-\d+)?$/.test(version)) continue;

    const keys = Object.keys(info as object);
    const ntsKey = keys.find((k) => /^nts-v[sc]\d+-x64$/i.test(k));
    const tsKey = keys.find((k) => /^ts-v[sc]\d+-x64$/i.test(k));

    const nts = ntsKey ? ((info as any)[ntsKey] as PhpReleaseFile) : undefined;
    const ts = tsKey ? ((info as any)[tsKey] as PhpReleaseFile) : undefined;

    if (nts?.zip?.path) {
      versions.push({
        version,
        downloadUrl: `${PHP_WIN_RELEASES_BASE}${nts.zip.path}`,
        type: "nts",
        arch: "x64",
      });
    }
    if (ts?.zip?.path) {
      versions.push({
        version: `${version}-ts`,
        downloadUrl: `${PHP_WIN_RELEASES_BASE}${ts.zip.path}`,
        type: "ts",
        arch: "x64",
      });
    }
  }
  // 同版本时保持插入顺序：nts 在前，ts 在后
  return sortSemverDesc(versions, (v) => v.version.replace(/-ts$/, ""));
}

export function parsePhpReleasesHtml(html: string): CatalogPhpVersion[] {
  const versions: CatalogPhpVersion[] = [];
  const seen = new Set<string>();

  const ntsRegex = /php-(\d+\.\d+\.\d+(?:-\d+)?)-nts-Win32-vs(\d+)-x64\.zip/g;
  let match: RegExpExecArray | null;
  while ((match = ntsRegex.exec(html)) !== null) {
    const version = match[1];
    const key = `${version}-nts`;
    if (seen.has(key)) continue;
    seen.add(key);
    versions.push({
      version,
      downloadUrl: `${PHP_WIN_RELEASES_BASE}php-${version}-nts-Win32-vs${match[2]}-x64.zip`,
      type: "nts",
      arch: "x64",
    });
  }

  const tsRegex = /php-(\d+\.\d+\.\d+(?:-\d+)?)-Win32-vs(\d+)-x64\.zip/g;
  while ((match = tsRegex.exec(html)) !== null) {
    if (match[0].includes("-nts-")) continue;
    const version = match[1];
    const key = `${version}-ts`;
    if (seen.has(key)) continue;
    seen.add(key);
    versions.push({
      version: `${version}-ts`,
      downloadUrl: `${PHP_WIN_RELEASES_BASE}php-${version}-Win32-vs${match[2]}-x64.zip`,
      type: "ts",
      arch: "x64",
    });
  }

  // 同版本时保持插入顺序：nts 在前，ts 在后
  return sortSemverDesc(versions, (v) => v.version.replace(/-ts$/, ""));
}

export function fallbackPhp(): CatalogPhpVersion[] {
  return parsePhpReleasesJson({
    "8.5": {
      version: "8.5.12-1",
      "nts-vs17-x64": { zip: { path: "php-8.5.12-1-nts-Win32-vs17-x64.zip" } },
      "ts-vs17-x64": { zip: { path: "php-8.5.12-1-Win32-vs17-x64.zip" } },
    },
    "8.4": {
      version: "8.4.27-1",
      "nts-vs17-x64": { zip: { path: "php-8.4.27-1-nts-Win32-vs17-x64.zip" } },
      "ts-vs17-x64": { zip: { path: "php-8.4.27-1-Win32-vs17-x64.zip" } },
    },
    "8.3": {
      version: "8.3.36-1",
      "nts-vs16-x64": { zip: { path: "php-8.3.36-1-nts-Win32-vs16-x64.zip" } },
      "ts-vs16-x64": { zip: { path: "php-8.3.36-1-Win32-vs16-x64.zip" } },
    },
  });
}

export async function catalogPhp(): Promise<CatalogPhpVersion[]> {
  try {
    const json = await httpGetJson<Record<string, any>>(
      `${PHP_WIN_RELEASES_BASE}releases.json`,
    );
    const parsed = parsePhpReleasesJson(json);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] PHP releases.json 失败:", e);
  }
  try {
    const html = await httpGetText(PHP_WIN_RELEASES_BASE);
    const parsed = parsePhpReleasesHtml(html);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] PHP 目录页失败:", e);
  }
  return fallbackPhp();
}

// ---------------------------------------------------------------------------
// Node.js — official index.json
// ---------------------------------------------------------------------------

export interface CatalogNodeVersion {
  version: string;
  date: string;
  lts: string | false;
  security: boolean;
  downloadUrl: string;
}

export interface NodeIndexEntry {
  version: string;
  date?: string;
  lts?: string | false;
  security?: boolean;
  files?: string[];
}

export function selectNodeVersions(index: NodeIndexEntry[]): CatalogNodeVersion[] {
  const win = index.filter((v) => {
    if (!v.files?.includes("win-x64-zip")) return false;
    const major = Number(v.version.replace(/^v/, "").split(".")[0]);
    return Number.isFinite(major) && major >= 18;
  });
  const picked: NodeIndexEntry[] = [];
  const seen = new Set<string>();
  const push = (v: NodeIndexEntry) => {
    if (!v.version || seen.has(v.version)) return;
    seen.add(v.version);
    picked.push(v);
  };

  for (const v of win.slice(0, 12)) push(v);

  const byMajor = new Map<string, NodeIndexEntry>();
  for (const v of win) {
    const major = v.version.replace(/^v/, "").split(".")[0];
    if (!byMajor.has(major)) byMajor.set(major, v);
  }
  for (const [major, v] of byMajor) {
    const n = Number(major);
    if (n >= 18 && n % 2 === 0) push(v);
  }

  return picked.map((v) => ({
    version: v.version,
    date: v.date || "",
    lts: v.lts ?? false,
    security: !!v.security,
    downloadUrl: `https://nodejs.org/dist/${v.version}/node-${v.version}-win-x64.zip`,
  }));
}

export async function catalogNode(): Promise<CatalogNodeVersion[]> {
  try {
    const index = await httpGetJson<NodeIndexEntry[]>(
      "https://nodejs.org/dist/index.json",
    );
    const parsed = selectNodeVersions(index);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] Node index.json 失败:", e);
  }
  return [
    {
      version: "v24.19.0",
      date: "",
      lts: "Krypton",
      security: false,
      downloadUrl: "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip",
    },
    {
      version: "v22.23.2",
      date: "",
      lts: "Jod",
      security: false,
      downloadUrl: "https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip",
    },
  ];
}

// ---------------------------------------------------------------------------
// Go — official go.dev/dl JSON (include=all for history)
// ---------------------------------------------------------------------------

export interface CatalogGoVersion {
  version: string;
  stable: boolean;
  downloadUrl: string;
  filename: string;
}

export function parseGoDlJson(releases: any[]): CatalogGoVersion[] {
  const versions: CatalogGoVersion[] = [];
  for (const rel of releases || []) {
    if (!rel?.version) continue;
    const winZip = (rel.files || []).find(
      (f: any) =>
        f.os === "windows" &&
        f.arch === "amd64" &&
        String(f.filename || "").endsWith(".zip"),
    );
    if (!winZip) continue;
    versions.push({
      version: rel.version,
      stable: rel.stable ?? true,
      downloadUrl: `https://go.dev/dl/${winZip.filename}`,
      filename: winZip.filename,
    });
  }
  const stables = versions.filter((v) => v.stable);
  return (stables.length ? stables : versions).slice(0, 20);
}

export async function catalogGo(): Promise<CatalogGoVersion[]> {
  try {
    const releases = await httpGetJson<any[]>(
      "https://go.dev/dl/?mode=json&include=all",
    );
    const parsed = parseGoDlJson(releases);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] go.dev/dl 失败:", e);
  }
  try {
    const releases = await httpGetJson<any[]>("https://go.dev/dl/?mode=json");
    const parsed = parseGoDlJson(releases);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] go.dev/dl 精简列表失败:", e);
  }
  return [
    {
      version: "go1.26.6",
      stable: true,
      downloadUrl: "https://go.dev/dl/go1.26.6.windows-amd64.zip",
      filename: "go1.26.6.windows-amd64.zip",
    },
    {
      version: "go1.25.13",
      stable: true,
      downloadUrl: "https://go.dev/dl/go1.25.13.windows-amd64.zip",
      filename: "go1.25.13.windows-amd64.zip",
    },
  ];
}

// ---------------------------------------------------------------------------
// Python — official ftp.python.org directory (embed-amd64.zip)
// ---------------------------------------------------------------------------

export interface CatalogPythonVersion {
  version: string;
  downloadUrl: string;
  type: "embed";
}

export function parsePythonFtpDirs(html: string): string[] {
  const dirs = new Set<string>();
  const re = /href="(\d+\.\d+\.\d+)\/?"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    dirs.add(match[1]);
  }
  return [...dirs];
}

export function pickLatestPythonPerMinor(
  versions: string[],
  minMinor = 9,
): string[] {
  return [...groupPythonByMinor(versions, minMinor).values()].map((list) => list[0]);
}

export function groupPythonByMinor(
  versions: string[],
  minMinor = 9,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const v of versions) {
    if (!/^\d+\.\d+\.\d+$/.test(v)) continue;
    const [maj, min] = v.split(".").map(Number);
    if (maj < 3 || (maj === 3 && min < minMinor)) continue;
    const key = `${maj}.${min}`;
    const list = groups.get(key) || [];
    list.push(v);
    groups.set(key, list);
  }
  for (const [key, list] of groups) {
    groups.set(key, sortSemverDesc(list, (v) => v));
  }
  return new Map(
    [...groups.entries()].sort((a, b) => compareSemver(b[0] + ".0", a[0] + ".0")),
  );
}

export function pythonEmbedUrl(version: string): string {
  return `https://www.python.org/ftp/python/${version}/python-${version}-embed-amd64.zip`;
}

export async function catalogPython(): Promise<CatalogPythonVersion[]> {
  let dirs: string[] = [];
  try {
    const html = await httpGetText("https://www.python.org/ftp/python/");
    dirs = parsePythonFtpDirs(html);
  } catch (e) {
    console.error("[catalog] python.org/ftp 失败:", e);
  }

  if (!dirs.length) {
    return pickLatestPythonPerMinor([
      "3.14.0",
      "3.13.15",
      "3.12.11",
      "3.11.13",
      "3.10.18",
      "3.9.23",
    ]).map((version) => ({
      version,
      downloadUrl: pythonEmbedUrl(version),
      type: "embed" as const,
    }));
  }

  const groups = groupPythonByMinor(dirs);
  const checked = await mapPool([...groups.values()], 3, async (versions) => {
    for (const version of versions.slice(0, 8)) {
      try {
        const listing = await httpGetText(
          `https://www.python.org/ftp/python/${version}/`,
        );
        if (listing.includes(`python-${version}-embed-amd64.zip`)) {
          return {
            version,
            downloadUrl: pythonEmbedUrl(version),
            type: "embed" as const,
          };
        }
      } catch {
        // 继续尝试该系列更旧的补丁
      }
    }
    return null;
  });
  const found = checked.filter((v): v is CatalogPythonVersion => !!v);
  return found.length
    ? sortSemverDesc(found, (v) => v.version)
    : pickLatestPythonPerMinor(dirs).slice(0, 5).map((version) => ({
        version,
        downloadUrl: pythonEmbedUrl(version),
        type: "embed" as const,
      }));
}

// ---------------------------------------------------------------------------
// Nginx — official download.html + /download/ listing
// ---------------------------------------------------------------------------

export interface CatalogNginxVersion {
  version: string;
  downloadUrl: string;
}

export function parseNginxZipVersions(html: string): string[] {
  const set = new Set<string>();
  const re = /nginx-(\d+\.\d+\.\d+)\.zip/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    set.add(match[1]);
  }
  return [...set];
}

export function selectNginxVersions(versions: string[], limit = 10): CatalogNginxVersion[] {
  const modern = versions.filter((v) => {
    const major = parseInt(v.split(".")[0], 10);
    return major >= 1;
  });
  return sortSemverDesc(modern, (v) => v)
    .slice(0, limit)
    .map((version) => ({
      version,
      downloadUrl: `https://nginx.org/download/nginx-${version}.zip`,
    }));
}

export async function catalogNginx(): Promise<CatalogNginxVersion[]> {
  const found = new Set<string>();
  for (const url of [
    "https://nginx.org/en/download.html",
    "https://nginx.org/download/",
  ]) {
    try {
      const html = await httpGetText(url);
      for (const v of parseNginxZipVersions(html)) found.add(v);
    } catch (e) {
      console.error(`[catalog] ${url} 失败:`, e);
    }
  }
  const selected = selectNginxVersions([...found]);
  return selected.length
    ? selected
    : selectNginxVersions(["1.31.3", "1.30.4", "1.28.3", "1.26.3"]);
}

// ---------------------------------------------------------------------------
// Git for Windows — official GitHub releases (PortableGit 64-bit)
// ---------------------------------------------------------------------------

export interface CatalogGitVersion {
  version: string;
  downloadUrl: string;
  type: "portable";
}

export function parseGitForWindowsReleases(releases: any[]): CatalogGitVersion[] {
  const versions: CatalogGitVersion[] = [];
  const seen = new Set<string>();
  const portable = /^PortableGit-(\d+\.\d+\.\d+)(?:\.\d+)?-64-bit\.7z\.exe$/i;

  for (const rel of releases || []) {
    if (rel?.prerelease) continue;
    const assets: any[] = rel.assets || [];
    const asset = assets.find((a) => portable.test(String(a.name || "")));
    if (!asset?.browser_download_url) continue;
    const m = String(asset.name).match(portable);
    if (!m) continue;
    const version = m[1];
    if (seen.has(version)) continue;
    seen.add(version);
    versions.push({
      version,
      downloadUrl: asset.browser_download_url,
      type: "portable",
    });
  }
  return versions.slice(0, 10);
}

export async function catalogGit(): Promise<CatalogGitVersion[]> {
  try {
    const releases = await httpGetJson<any[]>(
      "https://api.github.com/repos/git-for-windows/git/releases?per_page=30",
      GITHUB_HEADERS,
    );
    const parsed = parseGitForWindowsReleases(releases);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] GitHub git-for-windows 失败:", e);
  }
  return [
    {
      version: "2.55.0",
      downloadUrl:
        "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.1/PortableGit-2.55.0-64-bit.7z.exe",
      type: "portable",
    },
  ];
}

// ---------------------------------------------------------------------------
// Redis Windows — redis-windows/redis-windows (msys2 zip preferred)
// ---------------------------------------------------------------------------

export interface CatalogRedisVersion {
  version: string;
  downloadUrl: string;
}

export function pickRedisAsset(assets: any[]): any | undefined {
  const zips = (assets || []).filter((a) =>
    String(a.name || "").toLowerCase().endsWith(".zip"),
  );
  const prefer = [
    /Windows-x64-msys2\.zip$/i,
    /Redis-\d[\d.]*-Windows-x64\.zip$/i,
    /Windows-x64\.zip$/i,
    /Windows-x64-cygwin\.zip$/i,
  ];
  for (const re of prefer) {
    const hit = zips.find(
      (a) => re.test(String(a.name || "")) && !/with-Service/i.test(String(a.name || "")),
    );
    if (hit) return hit;
  }
  return zips.find((a) => /Windows-x64/i.test(String(a.name || "")));
}

export function parseRedisReleases(releases: any[]): CatalogRedisVersion[] {
  const versions: CatalogRedisVersion[] = [];
  for (const rel of releases || []) {
    const version = String(rel.tag_name || "").replace(/^v/, "");
    if (!version) continue;
    const asset = pickRedisAsset(rel.assets || []);
    if (!asset?.browser_download_url) continue;
    versions.push({ version, downloadUrl: asset.browser_download_url });
  }
  return versions.slice(0, 15);
}

export async function catalogRedis(): Promise<CatalogRedisVersion[]> {
  try {
    const releases = await httpGetJson<any[]>(
      "https://api.github.com/repos/redis-windows/redis-windows/releases?per_page=20",
      GITHUB_HEADERS,
    );
    const parsed = parseRedisReleases(releases);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] GitHub redis-windows 失败:", e);
  }
  return [
    {
      version: "8.10.0",
      downloadUrl:
        "https://github.com/redis-windows/redis-windows/releases/download/8.10.0/Redis-8.10.0-Windows-x64-msys2.zip",
    },
  ];
}

// ---------------------------------------------------------------------------
// MySQL — official CDN zips, versions from mysql-server tags
// ---------------------------------------------------------------------------

export interface CatalogMysqlVersion {
  version: string;
  downloadUrl: string;
  mirrors: string[];
}

export function parseMysqlTags(tags: any[]): string[] {
  const versions = new Set<string>();
  for (const tag of tags || []) {
    const name = String(tag.name || tag);
    const m = name.match(/^(?:mysql|mysql-cluster)-(\d+\.\d+\.\d+)$/i);
    if (m) versions.add(m[1]);
  }
  return [...versions];
}

function pickMysqlBySeries(versions: string[], counts: {
  modern: number;
  nine: number;
  eightFour: number;
  eightZero: number;
}): string[] {
  const parsed = versions
    .map((v) => {
      const [a, b, c] = v.split(".").map(Number);
      return { v, a, b, c };
    })
    .filter((p) => p.a >= 8)
    .sort((x, y) => y.a - x.a || y.b - x.b || y.c - x.c);

  const picked: string[] = [];
  const take = (pred: (p: (typeof parsed)[0]) => boolean, n: number) => {
    let count = 0;
    for (const p of parsed) {
      if (!pred(p) || picked.includes(p.v)) continue;
      picked.push(p.v);
      if (++count >= n) break;
    }
  };

  take((p) => p.a >= 10, counts.modern);
  take((p) => p.a === 9, counts.nine);
  take((p) => p.a === 8 && p.b === 4, counts.eightFour);
  take((p) => p.a === 8 && p.b === 0, counts.eightZero);
  return picked;
}

export function pickMysqlSeries(versions: string[]): string[] {
  return pickMysqlBySeries(versions, {
    modern: 2,
    nine: 2,
    eightFour: 2,
    eightZero: 2,
  });
}

export function pickMysqlCandidates(versions: string[]): string[] {
  return pickMysqlBySeries(versions, {
    modern: 3,
    nine: 4,
    eightFour: 4,
    eightZero: 6,
  });
}

export function mysqlOfficialZip(version: string): string {
  const majorMinor = version.split(".").slice(0, 2).join(".");
  return `https://cdn.mysql.com/Downloads/MySQL-${majorMinor}/mysql-${version}-winx64.zip`;
}

export function mysqlHuaweiMirror(version: string): string {
  const majorMinor = version.split(".").slice(0, 2).join(".");
  return `https://repo.huaweicloud.com/mysql/Downloads/MySQL-${majorMinor}/mysql-${version}-winx64.zip`;
}

export async function catalogMysql(): Promise<CatalogMysqlVersion[]> {
  let versions: string[] = [];
  try {
    const tags = await httpGetJson<any[]>(
      "https://api.github.com/repos/mysql/mysql-server/tags?per_page=100",
      GITHUB_HEADERS,
    );
    versions = pickMysqlCandidates(parseMysqlTags(tags));
  } catch (e) {
    console.error("[catalog] MySQL GitHub tags 失败:", e);
  }

  if (!versions.length) {
    versions = ["26.7.0", "9.7.2", "8.4.11", "8.0.46"];
  }

  const checked = await mapPool(versions, 4, async (version) => {
    const downloadUrl = mysqlOfficialZip(version);
    const mirrors = [mysqlHuaweiMirror(version)];
    if (await httpExists(downloadUrl)) {
      return { version, downloadUrl, mirrors };
    }
    if (await httpExists(mirrors[0])) {
      return { version, downloadUrl: mirrors[0], mirrors: [downloadUrl] };
    }
    return null;
  });

  const found = checked.filter((v): v is CatalogMysqlVersion => !!v);
  if (found.length) {
    const trimmed = pickMysqlSeries(found.map((v) => v.version))
      .map((v) => found.find((x) => x.version === v))
      .filter((v): v is CatalogMysqlVersion => !!v);
    return sortSemverDesc(trimmed, (v) => v.version);
  }

  return [
    {
      version: "8.4.11",
      downloadUrl: mysqlOfficialZip("8.4.11"),
      mirrors: [mysqlHuaweiMirror("8.4.11")],
    },
    {
      version: "8.0.46",
      downloadUrl: mysqlOfficialZip("8.0.46"),
      mirrors: [mysqlHuaweiMirror("8.0.46")],
    },
  ];
}

// ---------------------------------------------------------------------------
// Rust — rustup channels + official stable channel + GitHub history
// ---------------------------------------------------------------------------

export interface CatalogRustVersion {
  name: string;
  label: string;
  type: "channel" | "version";
  date?: string;
}

export function parseRustStableToml(toml: string): string | null {
  const m = toml.match(/\[pkg\.rust\][\s\S]*?version\s*=\s*"(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

export function parseRustGithubReleases(
  releases: any[],
): { version: string; date: string }[] {
  const list: { version: string; date: string }[] = [];
  for (const r of releases || []) {
    const v = String(r.tag_name || "").trim();
    if (/^\d+\.\d+\.\d+$/.test(v) && !r.prerelease) {
      list.push({ version: v, date: String(r.published_at || "").slice(0, 10) });
    }
  }
  return list;
}

export async function catalogRust(): Promise<CatalogRustVersion[]> {
  const list: CatalogRustVersion[] = [
    { name: "stable", label: "stable（稳定版）", type: "channel" },
    { name: "beta", label: "beta（测试版）", type: "channel" },
    { name: "nightly", label: "nightly（每日构建）", type: "channel" },
  ];
  const seen = new Set<string>(["stable", "beta", "nightly"]);

  try {
    const toml = await httpGetText(
      "https://static.rust-lang.org/dist/channel-rust-stable.toml",
    );
    const current = parseRustStableToml(toml);
    if (current && !seen.has(current)) {
      seen.add(current);
      list.push({
        name: current,
        label: `${current}（当前稳定）`,
        type: "version",
      });
    }
  } catch (e) {
    console.error("[catalog] rust stable channel 失败:", e);
  }

  try {
    const releases = await httpGetJson<any[]>(
      "https://api.github.com/repos/rust-lang/rust/releases?per_page=20",
      GITHUB_HEADERS,
    );
    for (const v of parseRustGithubReleases(releases)) {
      if (seen.has(v.version)) continue;
      seen.add(v.version);
      list.push({
        name: v.version,
        label: v.version,
        type: "version",
        date: v.date,
      });
    }
  } catch (e) {
    console.error("[catalog] rust GitHub releases 失败:", e);
  }

  return list;
}

// ---------------------------------------------------------------------------
// Java — Eclipse Temurin (Adoptium) official API
// ---------------------------------------------------------------------------

export interface CatalogJavaVersion {
  version: string;
  major: number;
  lts: boolean;
  downloadUrl: string;
}

export function parseAdoptiumLatest(
  assets: any[],
  major: number,
  lts: boolean,
): CatalogJavaVersion | null {
  const jdk = (assets || []).find(
    (a) => a?.binary?.package?.link && a?.binary?.image_type === "jdk",
  ) || (assets || []).find((a) => a?.binary?.package?.link);
  if (!jdk?.binary?.package?.link) return null;
  const raw = String(jdk.version?.semver || jdk.release_name || "");
  const version = raw.replace(/\+.*$/, "").replace(/^jdk-/, "");
  if (!version) return null;
  return { version, major, lts, downloadUrl: jdk.binary.package.link };
}

export async function catalogJava(): Promise<CatalogJavaVersion[]> {
  try {
    const info = await httpGetJson<{
      available_lts_releases?: number[];
      most_recent_feature_release?: number;
    }>("https://api.adoptium.net/v3/info/available_releases");
    const lts = info.available_lts_releases || [];
    const feature = info.most_recent_feature_release;
    const majors = [...new Set([...lts, feature].filter((n): n is number => !!n))]
      .sort((a, b) => b - a)
      .slice(0, 6);
    const versions: CatalogJavaVersion[] = [];
    for (const major of majors) {
      try {
        const assets = await httpGetJson<any[]>(
          `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=x64&image_type=jdk`,
        );
        const parsed = parseAdoptiumLatest(assets, major, lts.includes(major));
        if (parsed) versions.push(parsed);
      } catch (e) {
        console.error(`[catalog] Temurin ${major} 失败:`, e);
      }
    }
    if (versions.length) return versions;
  } catch (e) {
    console.error("[catalog] Adoptium 失败:", e);
  }
  return [
    {
      version: "21.0.12",
      major: 21,
      lts: true,
      downloadUrl:
        "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12_8.zip",
    },
  ];
}

// ---------------------------------------------------------------------------
// .NET SDK — official release-metadata
// ---------------------------------------------------------------------------

export interface CatalogDotnetVersion {
  version: string;
  channel: string;
  support: string;
  downloadUrl: string;
}

export function pickDotnetWinZip(release: any): string | null {
  const files = release?.sdk?.files || release?.sdks?.[0]?.files || [];
  const zip = (files as any[]).find(
    (f) =>
      f.rid === "win-x64" &&
      String(f.url || f.name || "").toLowerCase().includes(".zip"),
  );
  return zip?.url || null;
}

export async function catalogDotnet(): Promise<CatalogDotnetVersion[]> {
  try {
    const index = await httpGetJson<{ "releases-index": any[] }>(
      "https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json",
    );
    const channels = (index["releases-index"] || []).filter((c) =>
      ["active", "maintenance", "lts"].includes(String(c["support-phase"] || "")),
    );
    const versions: CatalogDotnetVersion[] = [];
    for (const ch of channels.slice(0, 5)) {
      try {
        const rel = await httpGetJson<any>(ch["releases.json"]);
        const latestSdk = String(ch["latest-sdk"] || "");
        const release =
          (rel.releases || []).find((r: any) => r.sdk?.version === latestSdk) ||
          (rel.releases || [])[0];
        const url = pickDotnetWinZip(release);
        if (!url) continue;
        versions.push({
          version: release?.sdk?.version || latestSdk,
          channel: String(ch["channel-version"] || ""),
          support: String(ch["support-phase"] || ""),
          downloadUrl: url,
        });
      } catch (e) {
        console.error("[catalog] .NET channel 失败:", e);
      }
    }
    if (versions.length) return versions;
  } catch (e) {
    console.error("[catalog] .NET releases-index 失败:", e);
  }
  return [
    {
      version: "8.0.413",
      channel: "8.0",
      support: "lts",
      downloadUrl:
        "https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.413/dotnet-sdk-8.0.413-win-x64.zip",
    },
  ];
}

// ---------------------------------------------------------------------------
// PostgreSQL — official versions.json + EDB Windows binaries
// ---------------------------------------------------------------------------

export interface CatalogPostgresVersion {
  version: string;
  downloadUrl: string;
}

export function postgresBinaryUrl(version: string, build = 1): string {
  return `https://get.enterprisedb.com/postgresql/postgresql-${version}-${build}-windows-x64-binaries.zip`;
}

export function parsePostgresVersionsJson(rows: any[]): string[] {
  return (rows || [])
    .filter((r) => r?.supported && Number(r.major) >= 14)
    .map((r) => `${r.major}.${r.latestMinor}`)
    .filter((v) => /^\d+\.\d+$/.test(v));
}

export async function catalogPostgres(): Promise<CatalogPostgresVersion[]> {
  let versions: string[] = [];
  try {
    const rows = await httpGetJson<any[]>("https://www.postgresql.org/versions.json");
    versions = parsePostgresVersionsJson(rows);
  } catch (e) {
    console.error("[catalog] postgresql.org/versions.json 失败:", e);
  }
  if (!versions.length) versions = ["17.5", "16.8", "15.12"];

  const found = await mapPool(versions, 3, async (version) => {
    for (const build of [1, 2, 3]) {
      const downloadUrl = postgresBinaryUrl(version, build);
      if (await httpExists(downloadUrl)) return { version, downloadUrl };
    }
    return null;
  });
  const list = found.filter((v): v is CatalogPostgresVersion => !!v);
  return list.length
    ? sortSemverDesc(list, (v) => v.version)
    : [{ version: "17.5", downloadUrl: postgresBinaryUrl("17.5") }];
}

// ---------------------------------------------------------------------------
// MongoDB — official downloads.mongodb.org/current.json
// ---------------------------------------------------------------------------

export interface CatalogMongoVersion {
  version: string;
  downloadUrl: string;
}

export function parseMongoCurrent(json: any): CatalogMongoVersion[] {
  const versions: CatalogMongoVersion[] = [];
  for (const v of json?.versions || []) {
    const version = String(v.version || "");
    if (!version || /rc|alpha|beta/i.test(version)) continue;
    const d = (v.downloads || []).find(
      (x: any) =>
        x.target === "windows" &&
        x.arch === "x86_64" &&
        x.edition === "base" &&
        String(x.archive?.url || "").endsWith(".zip"),
    );
    if (!d?.archive?.url) continue;
    versions.push({ version, downloadUrl: d.archive.url });
  }
  return versions.slice(0, 12);
}

export async function catalogMongo(): Promise<CatalogMongoVersion[]> {
  try {
    const json = await httpGetJson("https://downloads.mongodb.org/current.json");
    const parsed = parseMongoCurrent(json);
    if (parsed.length) return parsed;
  } catch (e) {
    console.error("[catalog] MongoDB current.json 失败:", e);
  }
  return [
    {
      version: "8.0.4",
      downloadUrl:
        "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.0.4.zip",
    },
  ];
}
