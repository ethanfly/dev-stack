import { ConfigStore } from "./ConfigStore";
import { exec } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  renameSync,
} from "fs";
import { dirname, join } from "path";
import { sendDownloadProgress } from "../main";
import { PathManager } from "./PathManager";
import { catalogJava } from "./catalog";
import { downloadToFile } from "./httpClient";
import { extractZip, findFile } from "./archive";

const execAsync = promisify(exec);

interface JavaVersion {
  version: string;
  path: string;
  isActive: boolean;
  source: "managed" | "system";
}

export class JavaManager {
  private configStore: ConfigStore;
  private pathManager: PathManager;
  private cache: { versions: Awaited<ReturnType<typeof catalogJava>>; at: number } | null =
    null;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.pathManager = new PathManager(configStore);
  }

  getJavaRoot(): string {
    return join(this.configStore.getBasePath(), "java");
  }

  getJavaPath(version: string): string {
    return join(this.getJavaRoot(), `jdk-${version}`);
  }

  async getInstalledVersions(): Promise<JavaVersion[]> {
    const versions: JavaVersion[] = [];
    const active = this.configStore.get("activeJavaVersion") || "";
    const root = this.getJavaRoot();
    if (existsSync(root)) {
      for (const dir of readdirSync(root, { withFileTypes: true })) {
        if (!dir.isDirectory() || !dir.name.startsWith("jdk-")) continue;
        const path = join(root, dir.name);
        if (!existsSync(join(path, "bin", "java.exe"))) continue;
        const version = dir.name.replace(/^jdk-/, "");
        versions.push({
          version,
          path,
          isActive: version === active,
          source: "managed",
        });
      }
    }
    const system = await this.detectSystemJava();
    if (system && !versions.some((v) => v.path === system.path || v.version === system.version)) {
      versions.push({
        version: system.version,
        path: system.path,
        isActive: system.version === active,
        source: "system",
      });
    }
    return versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  }

  async detectSystemJava(): Promise<{ version: string; path: string } | null> {
    try {
      const { stdout, stderr } = await execAsync(
        "java -XshowSettings:properties -version",
        { windowsHide: true, timeout: 8000 },
      );
      const out = `${stdout}\n${stderr}`;
      const home = (out.match(/java\.home\s*=\s*(.+)/i) || [])[1]?.trim();
      const ver = (out.match(/java\.version\s*=\s*([^\s]+)/i) || [])[1]?.trim() || "";
      if (!home) return null;
      const root = home.toLowerCase().endsWith("jre") ? dirname(home) : home;
      if (root.toLowerCase().startsWith(this.getJavaRoot().toLowerCase())) return null;
      return { version: ver.replace(/\+.*$/, ""), path: root };
    } catch {
      return null;
    }
  }

  async getAvailableVersions() {
    if (this.cache && Date.now() - this.cache.at < 5 * 60 * 1000) return this.cache.versions;
    const versions = await catalogJava();
    this.cache = { versions, at: Date.now() };
    return versions;
  }

  async install(version: string, downloadUrl: string) {
    try {
      const root = this.getJavaRoot();
      const dest = this.getJavaPath(version);
      const temp = this.configStore.getTempPath();
      const zip = join(temp, `jdk-${version}.zip`);
      const extractDir = join(temp, `jdk-extract-${version}`);
      if (!existsSync(root)) mkdirSync(root, { recursive: true });
      if (!existsSync(temp)) mkdirSync(temp, { recursive: true });
      if (existsSync(join(dest, "bin", "java.exe"))) {
        return { success: false, message: `Java ${version} 已安装` };
      }

      await downloadToFile(downloadUrl, zip, (d, t) => {
        sendDownloadProgress("java", t > 0 ? Math.round((d / t) * 100) : 0, d, t);
      });
      if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });
      await extractZip(zip, extractDir);
      const javaExe = findFile(extractDir, "java.exe");
      if (!javaExe) return { success: false, message: "解压失败：未找到 java.exe" };
      const jdkRoot = dirname(dirname(javaExe));
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      renameSync(jdkRoot, dest);
      try {
        unlinkSync(zip);
        rmSync(extractDir, { recursive: true, force: true });
      } catch {}

      const list = this.configStore.get("javaVersions") || [];
      if (!list.includes(version)) {
        list.push(version);
        this.configStore.set("javaVersions", list);
      }
      if (list.length === 1) await this.setActive(version);
      return { success: true, message: `Java ${version} 安装成功` };
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e.message}` };
    }
  }

  async uninstall(version: string) {
    try {
      const dest = this.getJavaPath(version);
      if (!existsSync(dest)) return { success: false, message: `Java ${version} 未安装` };
      if (this.configStore.get("activeJavaVersion") === version) {
        this.configStore.set("activeJavaVersion", "");
        await this.pathManager.remove(dest);
      }
      rmSync(dest, { recursive: true, force: true });
      const list = (this.configStore.get("javaVersions") || []).filter((v) => v !== version);
      this.configStore.set("javaVersions", list);
      return { success: true, message: `Java ${version} 已卸载` };
    } catch (e: any) {
      return { success: false, message: `卸载失败: ${e.message}` };
    }
  }

  async setActive(version: string) {
    const dest = this.getJavaPath(version);
    if (!existsSync(join(dest, "bin", "java.exe"))) {
      return { success: false, message: `Java ${version} 未安装` };
    }
    const result = await this.pathManager.add(
      [join(dest, "bin")],
      this.getJavaRoot(),
      { JAVA_HOME: dest },
    );
    if (!result.success) return { success: false, message: `设置环境变量失败: ${result.message}` };
    this.configStore.set("activeJavaVersion", version);
    this.configStore.set("activeJavaPath", "");
    return { success: true, message: `已将 Java ${version} 设为默认` };
  }

  async setActiveSystem(path: string) {
    const dir = path.trim();
    if (!existsSync(join(dir, "bin", "java.exe")) && !existsSync(join(dir, "java.exe"))) {
      return { success: false, message: `不是有效的 JDK 目录: ${dir}` };
    }
    const home = existsSync(join(dir, "bin", "java.exe")) ? dir : dirname(dir);
    let version = "system";
    try {
      const { stdout } = await execAsync(`"${join(home, "bin", "java.exe")}" -version`, {
        windowsHide: true,
        timeout: 8000,
      });
      const m = stdout.match(/version "([^"]+)"/);
      if (m) version = m[1];
    } catch {}
    const result = await this.pathManager.add(
      [join(home, "bin")],
      this.getJavaRoot(),
      { JAVA_HOME: home },
    );
    if (!result.success) return { success: false, message: result.message };
    this.configStore.set("activeJavaVersion", version);
    this.configStore.set("activeJavaPath", home);
    return { success: true, message: `系统 Java ${version} 已设为默认` };
  }

  async uninstallSystem(path: string) {
    const dir = path.trim();
    if (!existsSync(join(dir, "bin", "java.exe"))) {
      return { success: false, message: `该目录下找不到 bin/java.exe，拒绝删除: ${dir}` };
    }
    if ((this.configStore.get("activeJavaPath") || "").toLowerCase() === dir.toLowerCase()) {
      await this.pathManager.remove(dir);
      this.configStore.set("activeJavaVersion", "");
      this.configStore.set("activeJavaPath", "");
    }
    rmSync(dir, { recursive: true, force: true });
    return { success: true, message: `系统 Java 已卸载: ${dir}` };
  }
}
