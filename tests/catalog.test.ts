import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogDotnet,
  catalogGit,
  catalogJava,
  catalogMongo,
  catalogPostgres,
  catalogGo,
  catalogMysql,
  catalogNginx,
  catalogNode,
  catalogPhp,
  catalogPython,
  catalogRedis,
  catalogRust,
  compareSemver,
  parseAdoptiumLatest,
  parseGitForWindowsReleases,
  parseMongoCurrent,
  parsePostgresVersionsJson,
  pickDotnetWinZip,
  parseGoDlJson,
  parseMysqlTags,
  parseNginxZipVersions,
  parsePhpReleasesHtml,
  parsePhpReleasesJson,
  parsePythonFtpDirs,
  parseRedisReleases,
  parseRustGithubReleases,
  parseRustStableToml,
  pickMysqlSeries,
  pickLatestPythonPerMinor,
  pickRedisAsset,
  selectNginxVersions,
  selectNodeVersions,
} from "../electron/services/catalog.ts";
import { httpExists } from "../electron/services/httpClient.ts";

test("compareSemver orders dotted versions", () => {
  assert.ok(compareSemver("8.4.11", "8.4.10") > 0);
  assert.ok(compareSemver("v24.19.0", "v22.23.2") > 0);
  assert.ok(compareSemver("go1.26.6", "go1.25.13") > 0);
  assert.equal(compareSemver("1.31.3", "1.31.3"), 0);
});

test("parsePhpReleasesJson reads official nts/ts x64 zips", () => {
  const parsed = parsePhpReleasesJson({
    "8.5": {
      version: "8.5.9",
      "nts-vs17-x64": { zip: { path: "php-8.5.9-nts-Win32-vs17-x64.zip" } },
      "ts-vs17-x64": { zip: { path: "php-8.5.9-Win32-vs17-x64.zip" } },
    },
    "8.4": {
      version: "8.4.24",
      "nts-vs17-x64": { zip: { path: "php-8.4.24-nts-Win32-vs17-x64.zip" } },
    },
  });
  assert.ok(parsed.some((v) => v.version === "8.5.9" && v.type === "nts"));
  assert.ok(parsed.some((v) => v.version === "8.5.9-ts" && v.type === "ts"));
  assert.match(parsed[0].downloadUrl, /^https:\/\/downloads\.php\.net\//);
});

test("parsePhpReleasesHtml accepts both nts and ts filenames", () => {
  const html = `
    <a href="php-8.5.9-nts-Win32-vs17-x64.zip">nts</a>
    <a href="php-8.5.9-Win32-vs17-x64.zip">ts</a>
  `;
  const parsed = parsePhpReleasesHtml(html);
  assert.equal(parsed.length, 2);
  assert.ok(parsed.some((v) => v.version === "8.5.9"));
  assert.ok(parsed.some((v) => v.version === "8.5.9-ts"));
});

test("selectNodeVersions keeps current plus even LTS majors", () => {
  const index = [
    { version: "v26.7.0", files: ["win-x64-zip"], lts: false },
    { version: "v26.6.0", files: ["win-x64-zip"], lts: false },
    { version: "v25.9.0", files: ["win-x64-zip"], lts: false },
    { version: "v24.19.0", files: ["win-x64-zip"], lts: "Krypton" },
    { version: "v23.11.1", files: ["win-x64-zip"], lts: false },
    { version: "v22.23.2", files: ["win-x64-zip"], lts: "Jod" },
    { version: "v20.20.2", files: ["win-x64-zip"], lts: "Iron" },
    { version: "v18.20.8", files: ["win-x64-zip"], lts: "Hydrogen" },
    { version: "v16.20.2", files: ["win-x64-zip"], lts: "Gallium" },
  ];
  const selected = selectNodeVersions(index);
  const versions = selected.map((v) => v.version);
  assert.ok(versions.includes("v26.7.0"));
  assert.ok(versions.includes("v24.19.0"));
  assert.ok(versions.includes("v22.23.2"));
  assert.ok(versions.includes("v20.20.2"));
  assert.ok(versions.includes("v18.20.8"));
  assert.ok(!versions.includes("v16.20.2"));
});

test("parseGoDlJson prefers stable windows amd64 zip", () => {
  const parsed = parseGoDlJson([
    {
      version: "go1.26.6",
      stable: true,
      files: [
        { os: "windows", arch: "amd64", filename: "go1.26.6.windows-amd64.zip" },
        { os: "linux", arch: "amd64", filename: "go1.26.6.linux-amd64.tar.gz" },
      ],
    },
    {
      version: "go1.27rc1",
      stable: false,
      files: [
        { os: "windows", arch: "amd64", filename: "go1.27rc1.windows-amd64.zip" },
      ],
    },
  ]);
  assert.equal(parsed[0].version, "go1.26.6");
  assert.equal(parsed[0].filename, "go1.26.6.windows-amd64.zip");
  assert.ok(!parsed.some((v) => v.version.includes("rc")));
});

test("python ftp parser skips prerelease folders", () => {
  const html = `
    <a href="3.15.0/">3.15.0/</a>
    <a href="3.14.7/">3.14.7/</a>
    <a href="3.14.0/">3.14.0/</a>
    <a href="3.13.15/">3.13.15/</a>
    <a href="3.8.20/">3.8.20/</a>
  `;
  const dirs = parsePythonFtpDirs(html);
  const picked = pickLatestPythonPerMinor(dirs);
  assert.deepEqual(picked, ["3.15.0", "3.14.7", "3.13.15"]);
});

test("nginx parser accepts relative and absolute zip hrefs", () => {
  const listing = `href="nginx-0.7.52.zip" href="nginx-1.31.3.zip" href="nginx-1.30.4.zip"`;
  const page = `href="/download/nginx-1.31.3.zip" href="/download/nginx-1.28.3.zip"`;
  const selected = selectNginxVersions([
    ...parseNginxZipVersions(listing),
    ...parseNginxZipVersions(page),
  ]);
  assert.equal(selected[0].version, "1.31.3");
  assert.ok(!selected.some((v) => v.version.startsWith("0.")));
  assert.match(selected[0].downloadUrl, /nginx-1\.31\.3\.zip$/);
});

test("git-for-windows parser keeps latest portable 64-bit per x.y.z", () => {
  const parsed = parseGitForWindowsReleases([
    {
      prerelease: true,
      assets: [{ name: "PortableGit-2.53.0-64-bit.7z.exe", browser_download_url: "http://x/pre" }],
    },
    {
      prerelease: false,
      assets: [
        { name: "PortableGit-2.55.0.4-64-bit.7z.exe", browser_download_url: "http://x/25504" },
        { name: "PortableGit-2.55.0.4-arm64.7z.exe", browser_download_url: "http://x/arm" },
      ],
    },
    {
      prerelease: false,
      assets: [
        { name: "PortableGit-2.55.0-64-bit.7z.exe", browser_download_url: "http://x/25500" },
      ],
    },
    {
      prerelease: false,
      assets: [
        { name: "PortableGit-2.54.0-64-bit.7z.exe", browser_download_url: "http://x/254" },
      ],
    },
  ]);
  assert.equal(parsed[0].version, "2.55.0");
  assert.equal(parsed[0].downloadUrl, "http://x/25504");
  assert.equal(parsed[1].version, "2.54.0");
});

test("redis picker prefers msys2 zip without Windows service", () => {
  const asset = pickRedisAsset([
    { name: "Redis-8.10.0-Windows-x64-cygwin-with-Service.zip", browser_download_url: "cys" },
    { name: "Redis-8.10.0-Windows-x64-cygwin.zip", browser_download_url: "cy" },
    { name: "Redis-8.10.0-Windows-x64-msys2-with-Service.zip", browser_download_url: "ms" },
    { name: "Redis-8.10.0-Windows-x64-msys2.zip", browser_download_url: "m" },
  ]);
  assert.equal(asset.browser_download_url, "m");
  const parsed = parseRedisReleases([
    { tag_name: "8.10.0", assets: [{ name: "Redis-8.10.0-Windows-x64-msys2.zip", browser_download_url: "m" }] },
  ]);
  assert.equal(parsed[0].version, "8.10.0");
});

test("mysql tag picker keeps latest 26.x / 9.x / 8.4 / 8.0", () => {
  const versions = parseMysqlTags([
    { name: "mysql-cluster-26.7.0" },
    { name: "mysql-cluster-9.7.2" },
    { name: "mysql-cluster-9.7.1" },
    { name: "mysql-cluster-8.4.11" },
    { name: "mysql-cluster-8.4.10" },
    { name: "mysql-cluster-8.0.48" },
    { name: "mysql-cluster-8.0.47" },
    { name: "mysql-8.0.46" },
    { name: "not-a-tag" },
  ]);
  const picked = pickMysqlSeries(versions);
  assert.ok(picked.includes("26.7.0"));
  assert.ok(picked.includes("9.7.2"));
  assert.ok(picked.includes("8.4.11"));
  assert.ok(picked.includes("8.0.48"));
  assert.ok(!picked.includes("8.0.46"));
});

test("adoptium parser keeps jdk zip and strips build suffix", () => {
  const parsed = parseAdoptiumLatest(
    [
      {
        release_name: "jdk-21.0.12+8",
        version: { semver: "21.0.12+8.0.LTS" },
        binary: {
          image_type: "jdk",
          package: { link: "https://example.com/jdk.zip" },
        },
      },
    ],
    21,
    true,
  );
  assert.equal(parsed?.version, "21.0.12");
  assert.equal(parsed?.lts, true);
  assert.match(parsed?.downloadUrl || "", /jdk\.zip$/);
});

test("dotnet picker prefers win-x64 zip", () => {
  const url = pickDotnetWinZip({
    sdk: {
      version: "8.0.413",
      files: [
        { rid: "win-x86", url: "https://x/x86.zip" },
        { rid: "win-x64", url: "https://x/sdk-win-x64.zip" },
      ],
    },
  });
  assert.equal(url, "https://x/sdk-win-x64.zip");
});

test("postgres versions.json keeps supported 14+", () => {
  const versions = parsePostgresVersionsJson([
    { major: "17", latestMinor: "5", supported: true },
    { major: "13", latestMinor: "20", supported: true },
    { major: "12", latestMinor: "22", supported: false },
  ]);
  assert.deepEqual(versions, ["17.5"]);
});

test("mongo current.json keeps windows x64 community zips", () => {
  const parsed = parseMongoCurrent({
    versions: [
      {
        version: "8.3.8",
        downloads: [
          {
            target: "windows",
            arch: "x86_64",
            edition: "base",
            archive: { url: "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.3.8.zip" },
          },
        ],
      },
      { version: "8.3.8-rc0", downloads: [] },
    ],
  });
  assert.equal(parsed[0].version, "8.3.8");
});

test("rust parsers read stable channel and github tags", () => {
  const ver = parseRustStableToml(`[pkg.rust]\nversion = "1.89.0 (aaaa 2026-01-01)"\n`);
  assert.equal(ver, "1.89.0");
  const rel = parseRustGithubReleases([
    { tag_name: "1.89.0", prerelease: false, published_at: "2026-01-01T00:00:00Z" },
    { tag_name: "1.89.0-beta.1", prerelease: true, published_at: "2025-12-01T00:00:00Z" },
  ]);
  assert.equal(rel[0].version, "1.89.0");
  assert.equal(rel.length, 1);
});

test("live official catalogs return installable latest URLs", { timeout: 120000 }, async () => {
  const [php, node, go, python, nginx, git, redis, rust, mysql, java, dotnet, postgres, mongo] =
    await Promise.all([
    catalogPhp(),
    catalogNode(),
    catalogGo(),
    catalogPython(),
    catalogNginx(),
    catalogGit(),
    catalogRedis(),
    catalogRust(),
    catalogMysql(),
    catalogJava(),
    catalogDotnet(),
    catalogPostgres(),
    catalogMongo(),
  ]);

  assert.ok(php.length >= 4, `php ${php.length}`);
  assert.ok(node.some((v) => v.lts), "node should include an LTS line");
  assert.ok(go[0].version.startsWith("go1."));
  assert.ok(python.length >= 4, `python ${python.map((v) => v.version).join(",")}`);
  assert.ok(nginx[0].version.startsWith("1."));
  assert.ok(compareSemver(git[0].version, "2.50.0") >= 0, `git latest ${git[0].version}`);
  assert.ok(redis.length >= 1);
  assert.ok(rust.some((v) => v.name === "stable"));
  assert.ok(mysql.length >= 2, `mysql ${mysql.length}`);
  assert.ok(java.length >= 1, `java ${java.length}`);
  assert.ok(dotnet.length >= 1, `dotnet ${dotnet.length}`);
  assert.ok(postgres.length >= 1, `postgres ${postgres.length}`);
  assert.ok(mongo.length >= 1, `mongo ${mongo.length}`);

  const heads = [
    php[0].downloadUrl,
    node[0].downloadUrl,
    go[0].downloadUrl,
    python[0].downloadUrl,
    nginx[0].downloadUrl,
    git[0].downloadUrl,
    redis[0].downloadUrl,
    mysql[0].downloadUrl,
    java[0].downloadUrl,
    dotnet[0].downloadUrl,
    postgres[0].downloadUrl,
    mongo[0].downloadUrl,
  ];
  const exists = await Promise.all(heads.map((url) => httpExists(url)));
  exists.forEach((ok, i) => {
    assert.ok(ok, `latest URL not reachable: ${heads[i]}`);
  });

  console.log("catalog latest", {
    php: php.slice(0, 4).map((v) => v.version),
    node: node.map((v) => v.version + (v.lts ? `(${v.lts})` : "")),
    go: go.slice(0, 4).map((v) => v.version),
    python: python.map((v) => v.version),
    nginx: nginx.map((v) => v.version),
    git: git.map((v) => v.version),
    redis: redis.slice(0, 4).map((v) => v.version),
    rust: rust.slice(0, 6).map((v) => v.name),
    mysql: mysql.map((v) => v.version),
    java: java.map((v) => v.version),
    dotnet: dotnet.map((v) => v.version),
    postgres: postgres.map((v) => v.version),
    mongo: mongo.map((v) => v.version),
  });
});
