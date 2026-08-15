import { ConfigStore } from "./ConfigStore";
import { exec } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  createWriteStream,
} from "fs";
import { join } from "path";
import https from "https";
import http from "http";
import { sendDownloadProgress } from "../main";
import { PathManager } from "./PathManager";
import { catalogRust } from "./catalog";

const execAsync = promisify(exec);

const RUSTUP_INIT_URLS = [
  "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe",
  "https://mirrors.ustc.edu.cn/rust-static/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe",
  "https://rsproxy.cn/rustup-init.exe",
];

interface RustVersion {
  version: string;
  label: string;
  path: string;
  isActive: boolean;
  source: "rustup" | "system";
}

interface AvailableRustVersion {
  name: string;
  label: string;
  type: "channel" | "version";
  date?: string;
}

export class RustManager {
  private configStore: ConfigStore;
  private pathManager: PathManager;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.pathManager = new PathManager(configStore);
  }

  getRustBasePath(): string {
    return join(this.configStore.getBasePath(), "rust");
  }

  private getCargoHome(): string {
    return join(this.getRustBasePath(), "cargo");
  }

  private getRustupHome(): string {
    return join(this.getRustBasePath(), "rustup");
  }

  private getManagedRustupExe(): string {
    return join(this.getCargoHome(), "bin", "rustup.exe");
  }

  /**
   * 解析 rustup.exe：托管目录 → mise shim → 用户 ~/.cargo → PATH。
   * 找不到则返回 null（不再把字面量 "rustup" 当已安装）。
   */
  private resolveRustupExe(): string | null {
    const candidates = [
      this.getManagedRustupExe(),
      join(process.env.LOCALAPPDATA || "", "mise", "shims", "rustup.exe"),
      join(process.env.USERPROFILE || "", ".cargo", "bin", "rustup.exe"),
    ];
    for (const c of candidates) {
      if (c && existsSync(c)) return c;
    }
    return null;
  }

  private rustEnv(): NodeJS.ProcessEnv {
    if (existsSync(this.getManagedRustupExe())) {
      return {
        ...process.env,
        CARGO_HOME: this.getCargoHome(),
        RUSTUP_HOME: this.getRustupHome(),
      };
    }
    return { ...process.env };
  }

  private async run(cmd: string, timeout = 30000): Promise<string> {
    const { stdout, stderr } = await execAsync(cmd, {
      windowsHide: true,
      timeout,
      env: this.rustEnv(),
    });
    return `${stdout || ""}${stderr || ""}`;
  }

  async getInstalledVersions(): Promise<RustVersion[]> {
    const versions: RustVersion[] = [];
    const rustupExe = this.resolveRustupExe();

    if (rustupExe) {
      try {
        const out = await this.run(`"${rustupExe}" toolchain list -v`, 15000);
        for (const line of out.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (/^no installed toolchain/i.test(trimmed)) continue;
          const m = trimmed.match(/^(\S+)(?:\s+\(([^)]*)\))?(?:\s+(.+))?$/);
          if (!m) continue;
          const full = m[1];
          if (!/^(stable|beta|nightly|\d+\.\d+)/.test(full) && !full.includes("-")) {
            continue;
          }
          const tags = m[2] || "";
          const path = (m[3] || "").trim();
          versions.push({
            version: full,
            label: full.replace(/-x86_64-pc-windows-msvc$/, ""),
            path,
            isActive: tags.includes("default") || tags.includes("active"),
            source: "rustup",
          });
        }
      } catch {
        // rustup 不可用，落到 system 探测
      }
    }

    if (versions.length === 0) {
      const sys = await this.detectSystemRust();
      if (sys) {
        versions.push({
          version: sys.version,
          label: sys.version,
          path: sys.path,
          isActive: true,
          source: "system",
        });
      }
    }

    return versions.sort((a, b) =>
      b.label.localeCompare(a.label, undefined, { numeric: true }),
    );
  }

  private async detectSystemRust(): Promise<{ version: string; path: string } | null> {
    try {
      const out = await this.run("rustc --version", 8000);
      const m = out.match(/rustc\s+([\d.]+)/);
      if (!m) return null;
      const version = m[1];
      try {
        const wout = await this.run("where rustc", 5000);
        const rustcPath = wout.trim().split(/\r?\n/)[0] || "";
        if (rustcPath) {
          const dir = rustcPath
            .replace(/[\\/]bin[\\/][^\\/]+$/, "")
            .replace(/[\\/]bin$/, "");
          return { version, path: dir };
        }
      } catch {}
      return { version, path: "" };
    } catch {
      return null;
    }
  }

  async getAvailableVersions(): Promise<AvailableRustVersion[]> {
    return catalogRust();
  }

  /**
   * 一键安装 rustup（下载 rustup-init.exe 静默执行）。
   * 默认同时装上 stable；传入 none 则只装 rustup。
   */
  async installRustup(
    defaultToolchain = "stable",
  ): Promise<{ success: boolean; message: string }> {
    if (this.resolveRustupExe()) {
      return { success: true, message: "本机已有 rustup，无需重复安装" };
    }

    const cargoHome = this.getCargoHome();
    const rustupHome = this.getRustupHome();
    const tempDir = this.configStore.getTempPath();
    for (const dir of [cargoHome, rustupHome, tempDir, join(cargoHome, "bin")]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    const initPath = join(tempDir, "rustup-init.exe");
    try {
      await this.downloadRustupInit(initPath);
    } catch (e: any) {
      return {
        success: false,
        message: `下载 rustup-init 失败: ${e.message}`,
      };
    }

    const toolchain = defaultToolchain.trim() || "stable";
    const args = [
      "-y",
      `--default-toolchain ${toolchain}`,
      "--profile default",
      "--no-modify-path",
    ].join(" ");

    try {
      await execAsync(`"${initPath}" ${args}`, {
        windowsHide: true,
        timeout: 600000,
        env: {
          ...process.env,
          CARGO_HOME: cargoHome,
          RUSTUP_HOME: rustupHome,
          RUSTUP_INIT_SKIP_PATH_CHECK: "yes",
        },
      });
    } catch (e: any) {
      return {
        success: false,
        message: `rustup-init 执行失败: ${e.message}`,
      };
    } finally {
      try {
        if (existsSync(initPath)) unlinkSync(initPath);
      } catch {
        // 忽略
      }
    }

    const rustupExe = this.getManagedRustupExe();
    if (!existsSync(rustupExe)) {
      return {
        success: false,
        message: "rustup-init 已结束，但未找到 rustup.exe，请重试",
      };
    }

    const binPath = join(cargoHome, "bin");
    const pathResult = await this.pathManager.add(
      [binPath],
      this.getRustBasePath(),
      {
        CARGO_HOME: cargoHome,
        RUSTUP_HOME: rustupHome,
      },
    );
    if (!pathResult.success) {
      return {
        success: false,
        message: `rustup 已安装，但写入 PATH 失败: ${pathResult.message}`,
      };
    }

    this.configStore.set("activeRustVersion", toolchain === "none" ? "" : toolchain);
    this.configStore.set("activeRustPath", binPath);

    return {
      success: true,
      message:
        toolchain === "none"
          ? "rustup 已安装，可以继续安装 toolchain"
          : `Rust（rustup + ${toolchain}）安装成功`,
    };
  }

  async install(name: string): Promise<{ success: boolean; message: string }> {
    const toolchain = (name || "stable").trim();
    if (!this.resolveRustupExe()) {
      return this.installRustup(toolchain);
    }

    const rustupExe = this.resolveRustupExe();
    try {
      const out = await this.run(`"${rustupExe}" install ${toolchain}`, 600000);
      return {
        success: true,
        message: `Rust toolchain ${toolchain} 安装成功\n${out.slice(-200)}`,
      };
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e.message}` };
    }
  }

  async uninstall(name: string): Promise<{ success: boolean; message: string }> {
    const rustupExe = this.resolveRustupExe();
    if (!rustupExe) return { success: false, message: "未检测到 rustup" };
    try {
      await this.run(`"${rustupExe}" uninstall ${name}`, 120000);
      return { success: true, message: `Rust toolchain ${name} 已卸载` };
    } catch (e: any) {
      return { success: false, message: `卸载失败: ${e.message}` };
    }
  }

  async setActive(name: string): Promise<{ success: boolean; message: string }> {
    const rustupExe = this.resolveRustupExe();
    if (!rustupExe) return { success: false, message: "未检测到 rustup" };
    try {
      await this.run(`"${rustupExe}" default ${name}`, 60000);
      this.configStore.set("activeRustVersion", name);
      const rustupExeDir = rustupExe.replace(/[\\/][^\\/]+$/, "");
      this.configStore.set("activeRustPath", rustupExeDir);
      return { success: true, message: `${name} 已设为默认 toolchain` };
    } catch (e: any) {
      return { success: false, message: `设置失败: ${e.message}` };
    }
  }

  async update(): Promise<{ success: boolean; message: string }> {
    const rustupExe = this.resolveRustupExe();
    if (!rustupExe) return { success: false, message: "未检测到 rustup" };
    try {
      const out = await this.run(`"${rustupExe}" update`, 600000);
      return { success: true, message: `更新完成\n${out.slice(-300)}` };
    } catch (e: any) {
      return { success: false, message: `更新失败: ${e.message}` };
    }
  }

  async checkSystem(): Promise<{
    installed: boolean;
    version?: string;
    rustcVersion?: string;
  }> {
    const rustupExe = this.resolveRustupExe();
    if (!rustupExe) {
      return { installed: false };
    }
    try {
      const out = await this.run(`"${rustupExe}" --version`, 8000);
      const m = out.match(/rustup\s+([\d.]+)/);
      let rustcVersion: string | undefined;
      try {
        const r = await this.run("rustc --version", 8000);
        const rm = r.match(/rustc\s+([\d.]+)/);
        if (rm) rustcVersion = rm[1];
      } catch {}
      return { installed: true, version: m ? m[1] : "unknown", rustcVersion };
    } catch {
      return { installed: false };
    }
  }

  private async downloadRustupInit(dest: string): Promise<void> {
    let lastError: Error | null = null;
    for (const url of RUSTUP_INIT_URLS) {
      try {
        await this.downloadFile(url, dest);
        if (existsSync(dest)) return;
      } catch (e: any) {
        lastError = e;
        try {
          if (existsSync(dest)) unlinkSync(dest);
        } catch {
          // 忽略
        }
      }
    }
    throw lastError || new Error("所有 rustup-init 下载源均失败");
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;
      const request = protocol.get(
        url,
        {
          headers: { "User-Agent": "DevStack" },
          timeout: 180000,
        },
        (response) => {
          if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              this.downloadFile(redirectUrl, dest).then(resolve).catch(reject);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(response.headers["content-length"] || "0", 10);
          let downloadedSize = 0;
          let lastProgressTime = 0;
          const file = createWriteStream(dest);

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
            const now = Date.now();
            if (now - lastProgressTime > 500) {
              const progress =
                totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
              sendDownloadProgress("rust", progress, downloadedSize, totalSize);
              lastProgressTime = now;
            }
          });

          response.pipe(file);
          file.on("finish", () => {
            file.close();
            sendDownloadProgress("rust", 100, totalSize, totalSize);
            resolve();
          });
          file.on("error", (err) => {
            try {
              unlinkSync(dest);
            } catch {}
            reject(err);
          });
        },
      );

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error("Download timeout"));
      });
    });
  }
}
