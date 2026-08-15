import { ConfigStore } from "./ConfigStore";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { sendDownloadProgress } from "../main";
import { PathManager } from "./PathManager";
import { catalogDotnet } from "./catalog";
import { downloadToFile } from "./httpClient";
import { extractZip } from "./archive";

const execAsync = promisify(exec);

interface DotnetVersion {
  version: string;
  path: string;
  isActive: boolean;
  source: "managed" | "system";
}

export class DotnetManager {
  private configStore: ConfigStore;
  private pathManager: PathManager;
  private cache: { versions: Awaited<ReturnType<typeof catalogDotnet>>; at: number } | null =
    null;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.pathManager = new PathManager(configStore);
  }

  getDotnetRoot(): string {
    return join(this.configStore.getBasePath(), "dotnet");
  }

  getDotnetPath(version: string): string {
    return join(this.getDotnetRoot(), `dotnet-${version}`);
  }

  async getInstalledVersions(): Promise<DotnetVersion[]> {
    const versions: DotnetVersion[] = [];
    const active = this.configStore.get("activeDotnetVersion") || "";
    const root = this.getDotnetRoot();
    if (existsSync(root)) {
      for (const dir of readdirSync(root, { withFileTypes: true })) {
        if (!dir.isDirectory() || !dir.name.startsWith("dotnet-")) continue;
        const path = join(root, dir.name);
        if (!existsSync(join(path, "dotnet.exe"))) continue;
        const version = dir.name.replace(/^dotnet-/, "");
        versions.push({
          version,
          path,
          isActive: version === active,
          source: "managed",
        });
      }
    }
    const system = await this.detectSystemDotnet();
    if (
      system &&
      !versions.some((v) => v.path === system.path || v.version === system.version)
    ) {
      versions.push({
        version: system.version,
        path: system.path,
        isActive: system.version === active,
        source: "system",
      });
    }
    return versions.sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  }

  async detectSystemDotnet(): Promise<{ version: string; path: string } | null> {
    try {
      const { stdout } = await execAsync("dotnet --list-sdks", {
        windowsHide: true,
        timeout: 8000,
      });
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      const m = last.match(/^([\d.]+)\s+\[(.+)\]/);
      if (!m) return null;
      const sdkRoot = m[2].replace(/[\\/]sdk$/i, "");
      if (sdkRoot.toLowerCase().startsWith(this.getDotnetRoot().toLowerCase())) return null;
      return { version: m[1], path: sdkRoot };
    } catch {
      return null;
    }
  }

  async getAvailableVersions() {
    if (this.cache && Date.now() - this.cache.at < 5 * 60 * 1000) return this.cache.versions;
    const versions = await catalogDotnet();
    this.cache = { versions, at: Date.now() };
    return versions;
  }

  async install(version: string, downloadUrl: string) {
    try {
      const dest = this.getDotnetPath(version);
      const temp = this.configStore.getTempPath();
      const zip = join(temp, `dotnet-${version}.zip`);
      if (!existsSync(this.getDotnetRoot())) mkdirSync(this.getDotnetRoot(), { recursive: true });
      if (!existsSync(temp)) mkdirSync(temp, { recursive: true });
      if (existsSync(join(dest, "dotnet.exe"))) {
        return { success: false, message: `.NET SDK ${version} 已安装` };
      }
      await downloadToFile(downloadUrl, zip, (d, t) => {
        sendDownloadProgress("dotnet", t > 0 ? Math.round((d / t) * 100) : 0, d, t);
      });
      mkdirSync(dest, { recursive: true });
      await extractZip(zip, dest);
      try {
        unlinkSync(zip);
      } catch {}
      if (!existsSync(join(dest, "dotnet.exe"))) {
        return { success: false, message: "安装失败：未找到 dotnet.exe" };
      }
      const list = this.configStore.get("dotnetVersions") || [];
      if (!list.includes(version)) {
        list.push(version);
        this.configStore.set("dotnetVersions", list);
      }
      if (list.length === 1) await this.setActive(version);
      return { success: true, message: `.NET SDK ${version} 安装成功` };
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e.message}` };
    }
  }

  async uninstall(version: string) {
    try {
      const dest = this.getDotnetPath(version);
      if (!existsSync(dest)) return { success: false, message: `.NET SDK ${version} 未安装` };
      if (this.configStore.get("activeDotnetVersion") === version) {
        this.configStore.set("activeDotnetVersion", "");
        await this.pathManager.remove(dest);
      }
      rmSync(dest, { recursive: true, force: true });
      this.configStore.set(
        "dotnetVersions",
        (this.configStore.get("dotnetVersions") || []).filter((v) => v !== version),
      );
      return { success: true, message: `.NET SDK ${version} 已卸载` };
    } catch (e: any) {
      return { success: false, message: `卸载失败: ${e.message}` };
    }
  }

  async setActive(version: string) {
    const dest = this.getDotnetPath(version);
    if (!existsSync(join(dest, "dotnet.exe"))) {
      return { success: false, message: `.NET SDK ${version} 未安装` };
    }
    const result = await this.pathManager.add(
      [dest],
      this.getDotnetRoot(),
      { DOTNET_ROOT: dest },
    );
    if (!result.success) return { success: false, message: result.message };
    this.configStore.set("activeDotnetVersion", version);
    this.configStore.set("activeDotnetPath", "");
    return { success: true, message: `已将 .NET SDK ${version} 设为默认` };
  }

  async setActiveSystem(path: string) {
    const dir = path.trim();
    if (!existsSync(join(dir, "dotnet.exe"))) {
      return { success: false, message: `该目录下找不到 dotnet.exe: ${dir}` };
    }
    let version = "system";
    try {
      const { stdout } = await execAsync(`"${join(dir, "dotnet.exe")}" --version`, {
        windowsHide: true,
        timeout: 8000,
      });
      version = stdout.trim() || version;
    } catch {}
    const result = await this.pathManager.add([dir], this.getDotnetRoot(), {
      DOTNET_ROOT: dir,
    });
    if (!result.success) return { success: false, message: result.message };
    this.configStore.set("activeDotnetVersion", version);
    this.configStore.set("activeDotnetPath", dir);
    return { success: true, message: `系统 .NET ${version} 已设为默认` };
  }

  async uninstallSystem(path: string) {
    const dir = path.trim();
    if (!existsSync(join(dir, "dotnet.exe"))) {
      return { success: false, message: `该目录下找不到 dotnet.exe，拒绝删除: ${dir}` };
    }
    if ((this.configStore.get("activeDotnetPath") || "").toLowerCase() === dir.toLowerCase()) {
      await this.pathManager.remove(dir);
      this.configStore.set("activeDotnetVersion", "");
      this.configStore.set("activeDotnetPath", "");
    }
    rmSync(dir, { recursive: true, force: true });
    return { success: true, message: `系统 .NET 已卸载: ${dir}` };
  }
}
