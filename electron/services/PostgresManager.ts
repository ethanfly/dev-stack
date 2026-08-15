import { ConfigStore } from "./ConfigStore";
import { exec } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  renameSync,
} from "fs";
import { dirname, join } from "path";
import { sendDownloadProgress } from "../main";
import { PathManager } from "./PathManager";
import { catalogPostgres } from "./catalog";
import { downloadToFile } from "./httpClient";
import { extractZip, findFile } from "./archive";

const execAsync = promisify(exec);

export class PostgresManager {
  private configStore: ConfigStore;
  private pathManager: PathManager;
  private cache: { versions: Awaited<ReturnType<typeof catalogPostgres>>; at: number } | null =
    null;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.pathManager = new PathManager(configStore);
  }

  getPostgresPath(): string {
    return join(this.configStore.getBasePath(), "postgres");
  }

  private bin(name: string): string {
    return join(this.getPostgresPath(), "bin", name);
  }

  async getInstalledVersions(): Promise<
    { version: string; path: string; isRunning: boolean }[]
  > {
    const path = this.getPostgresPath();
    if (!existsSync(this.bin("postgres.exe"))) return [];
    let version = "unknown";
    try {
      const { stdout } = await execAsync(`"${this.bin("postgres.exe")}" -V`, {
        windowsHide: true,
        timeout: 8000,
      });
      const m = stdout.match(/(\d+\.\d+)/);
      if (m) version = m[1];
    } catch {}
    return [{ version, path, isRunning: await this.isRunning() }];
  }

  async getAvailableVersions() {
    if (this.cache && Date.now() - this.cache.at < 5 * 60 * 1000) return this.cache.versions;
    const versions = await catalogPostgres();
    this.cache = { versions, at: Date.now() };
    return versions;
  }

  async install(version: string) {
    try {
      const available = await this.getAvailableVersions();
      const info = available.find((v) => v.version === version);
      if (!info) return { success: false, message: `未找到 PostgreSQL ${version}` };

      const dest = this.getPostgresPath();
      const temp = this.configStore.getTempPath();
      const zip = join(temp, `postgres-${version}.zip`);
      const extractDir = join(temp, `postgres-extract-${version}`);
      if (!existsSync(temp)) mkdirSync(temp, { recursive: true });

      if (existsSync(this.bin("postgres.exe"))) await this.stop();

      await downloadToFile(info.downloadUrl, zip, (d, t) => {
        sendDownloadProgress("postgres", t > 0 ? Math.round((d / t) * 100) : 0, d, t);
      });
      if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });
      await extractZip(zip, extractDir);
      const exe = findFile(extractDir, "postgres.exe");
      if (!exe) return { success: false, message: "解压失败：未找到 postgres.exe" };
      const pgsql = dirname(dirname(exe));
      if (existsSync(dest)) {
        const data = join(dest, "data");
        const keepData = existsSync(data) ? join(temp, `postgres-data-keep`) : "";
        if (keepData) {
          if (existsSync(keepData)) rmSync(keepData, { recursive: true, force: true });
          renameSync(data, keepData);
        }
        rmSync(dest, { recursive: true, force: true });
        mkdirSync(dest, { recursive: true });
        if (keepData && existsSync(keepData)) renameSync(keepData, join(dest, "data"));
      }
      renameSync(pgsql, dest);
      try {
        unlinkSync(zip);
        rmSync(extractDir, { recursive: true, force: true });
      } catch {}

      const dataDir = join(dest, "data");
      if (!existsSync(dataDir) || !existsSync(join(dataDir, "PG_VERSION"))) {
        mkdirSync(dataDir, { recursive: true });
        await execAsync(
          `"${this.bin("initdb.exe")}" -D "${dataDir}" -U postgres --auth=trust --encoding=UTF8 --no-locale`,
          { windowsHide: true, timeout: 120000, cwd: join(dest, "bin") },
        );
      }

      const list = this.configStore.get("postgresVersions") || [];
      if (!list.includes(version)) {
        list.push(version);
        this.configStore.set("postgresVersions", list);
      }
      await this.pathManager.add([join(dest, "bin")], dest);
      return {
        success: true,
        message: `PostgreSQL ${version} 安装成功\n\n连接：localhost:5432\n用户：postgres\n本机 trust 认证（无密码）`,
      };
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e.message}` };
    }
  }

  async uninstall() {
    try {
      await this.stop();
      const dest = this.getPostgresPath();
      if (!existsSync(dest)) return { success: false, message: "PostgreSQL 未安装" };
      await this.pathManager.remove(dest);
      rmSync(dest, { recursive: true, force: true });
      this.configStore.set("postgresVersions", []);
      return { success: true, message: "PostgreSQL 已卸载" };
    } catch (e: any) {
      return { success: false, message: `卸载失败: ${e.message}` };
    }
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq postgres.exe" /NH', {
        windowsHide: true,
        timeout: 5000,
      });
      return stdout.includes("postgres.exe");
    } catch {
      return false;
    }
  }

  async start() {
    try {
      if (!existsSync(this.bin("pg_ctl.exe"))) {
        return { success: false, message: "PostgreSQL 未安装" };
      }
      if (await this.isRunning()) return { success: true, message: "PostgreSQL 已经在运行" };
      const dataDir = join(this.getPostgresPath(), "data");
      const logFile = join(this.configStore.getLogsPath(), "postgres.log");
      if (!existsSync(this.configStore.getLogsPath())) {
        mkdirSync(this.configStore.getLogsPath(), { recursive: true });
      }
      await execAsync(
        `"${this.bin("pg_ctl.exe")}" -D "${dataDir}" -l "${logFile}" start`,
        { windowsHide: true, timeout: 30000, cwd: join(this.getPostgresPath(), "bin") },
      );
      return { success: true, message: "PostgreSQL 启动成功，端口 5432" };
    } catch (e: any) {
      return { success: false, message: `启动失败: ${e.message}` };
    }
  }

  async stop() {
    try {
      if (existsSync(this.bin("pg_ctl.exe"))) {
        try {
          await execAsync(
            `"${this.bin("pg_ctl.exe")}" -D "${join(this.getPostgresPath(), "data")}" stop -m fast`,
            { windowsHide: true, timeout: 20000 },
          );
        } catch {}
      }
      if (await this.isRunning()) {
        await execAsync("taskkill /F /IM postgres.exe", { windowsHide: true, timeout: 8000 }).catch(
          () => {},
        );
      }
      return { success: true, message: "PostgreSQL 已停止" };
    } catch (e: any) {
      return { success: false, message: `停止失败: ${e.message}` };
    }
  }

  async restart() {
    const s = await this.stop();
    if (!s.success) return s;
    await new Promise((r) => setTimeout(r, 800));
    return this.start();
  }

  async getStatus() {
    return { running: await this.isRunning(), port: 5432 };
  }
}
