import http from "http";
import https from "https";
import { createWriteStream, existsSync, unlinkSync } from "fs";

export const HTTP_UA = "DevStack/1.0 (Windows; Electron)";

const REDIRECT = new Set([301, 302, 303, 307, 308]);

export function isHttpRedirect(status?: number | null): boolean {
  return !!status && REDIRECT.has(status);
}

export interface HttpResponse {
  status: number;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function requestOnce(
  url: string,
  method: "GET" | "HEAD",
  extraHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`无效 URL: ${url}`));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "User-Agent": HTTP_UA,
          Accept: "*/*",
          ...extraHeaders,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            url,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`请求超时: ${url}`));
    });
    req.end();
  });
}

export async function httpRequest(
  url: string,
  options: {
    method?: "GET" | "HEAD";
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxRedirects?: number;
  } = {},
): Promise<HttpResponse> {
  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs ?? 25000;
  const maxRedirects = options.maxRedirects ?? 8;
  const headers = options.headers || {};

  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await requestOnce(current, method, headers, timeoutMs);
    if (REDIRECT.has(res.status) && res.headers.location) {
      current = new URL(res.headers.location, current).href;
      continue;
    }
    return { ...res, url: current };
  }
  throw new Error(`重定向过多: ${url}`);
}

export async function httpGetText(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 25000,
): Promise<string> {
  const res = await httpRequest(url, { method: "GET", headers, timeoutMs });
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return res.body;
}

export async function httpGetJson<T>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 25000,
): Promise<T> {
  const text = await httpGetText(
    url,
    { Accept: "application/json", ...headers },
    timeoutMs,
  );
  return JSON.parse(text) as T;
}

export async function httpExists(url: string, timeoutMs = 15000): Promise<boolean> {
  try {
    const head = await httpRequest(url, { method: "HEAD", timeoutMs });
    if (head.status >= 200 && head.status < 400) return true;
    if (head.status === 405 || head.status === 403) {
      const get = await httpRequest(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        timeoutMs,
      });
      return get.status === 200 || get.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function downloadToFile(
  url: string,
  dest: string,
  onProgress?: (downloaded: number, total: number) => void,
  redirects = 0,
): Promise<void> {
  if (redirects > 8) throw new Error(`重定向过多: ${url}`);

  await new Promise<void>((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`无效 URL: ${url}`));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(
      url,
      {
        headers: { "User-Agent": HTTP_UA, Accept: "*/*" },
        timeout: 600000,
      },
      (res) => {
        if (isHttpRedirect(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          downloadToFile(next, dest, onProgress, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        let last = 0;
        const file = createWriteStream(dest);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (onProgress && now - last > 400) {
            onProgress(downloaded, total);
            last = now;
          }
        });
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          onProgress?.(total || downloaded, total || downloaded);
          resolve();
        });
        file.on("error", (err) => {
          file.close();
          if (existsSync(dest)) unlinkSync(dest);
          reject(err);
        });
      },
    );
    req.on("error", (err) => {
      if (existsSync(dest)) unlinkSync(dest);
      reject(err);
    });
    req.on("timeout", () => {
      req.destroy();
      if (existsSync(dest)) unlinkSync(dest);
      reject(new Error("下载超时"));
    });
  });
}
