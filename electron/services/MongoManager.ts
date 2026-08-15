import { ConfigStore } from "./ConfigStore";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  readdirSync,
  rmdirSync,
} from "fs";
import { dirname, join } from "path";
import { sendDownloadProgress } from "../main";
import { PathManager } from "./PathManager";
import { catalogMongo } from "./catalog";
import { downloadToFile } from "./httpClient";
import { extractZip, findFile } from "./archive";

const execAsync = promisify(exec);

export class MongoManager {
  private configStore: ConfigStore;
  private pathManager: PathManager;
  private cache: { versions: Awaited<ReturnType<typeof catalogMongo>>; at: number } | null =
    null;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.pathManager = new PathManager(configStore);
  }

  getMongoPath(): string {
    return join(this.configStore.getBasePath(), "mongodb");
  }

  private exe(): string {
    return join(this.getMongoPath(), "bin", "mongod.exe");
  }

  async getInstalledVersions(): Promise<
    { version: string; path: string; isRunning: boolean }[]
  > {
    if (!existsSync(this.exe())) return [];
    let version = "unknown";
    try {
      const { stdout } = await execAsync(`"${this.exe()}" --version`, {
        windowsHide: true,
        timeout: 8000,
      });
      const m = stdout.match(/db version v([\d.]+)/i);
      if (m) version = m[1];
    } catch {}
    return [{ version, path: this.getMongoPath(), isRunning: await this.isRunning() }];
  }

  async getAvailableVersions() {
    if (this.cache && Date.now() - this.cache.at < 5 * 60 * 1000) return this.cache.versions;
    const versions = await catalogMongo();
    this.cache = { versions, at: Date.now() };
    return versions;
  }

  async install(version: string) {
    try {
      const available = await this.getAvailableVersions();
      const info = available.find((v) => v.version === version);
      if (!info) return { success: false, message: `未找到 MongoDB ${version}` };

      const dest = this.getMongoPath();
      const temp = this.configStore.getTempPath();
      const zip = join(temp, `mongodb-${version}.zip`);
      if (!existsSync(temp)) mkdirSync(temp, { recursive: true });
      if (existsSync(this.exe())) await this.stop();

      await downloadToFile(info.downloadUrl, zip, (d, t) => {
        sendDownloadProgress("mongodb", t > 0 ? Math.round((d / t) * 100) : 0, d, t);
      });

      const dataKeep = join(dest, "data");
      const savedData = existsSync(dataKeep) ? join(temp, "mongodb-data-keep") : "";
      if (savedData) {
        if (existsSync(savedData)) rmSync(savedData, { recursive: true, force: true });
        renameSafe(dataKeep, savedData);
      }
      if (existsSync(dest)) {
        for (const item of readdirSync(dest, { withFileTypes: true })) {
          if (item.name === "data") continue;
          const p = join(dest, item.name);
          if (item.isDirectory()) rmSync(p, { recursive: true, force: true });
          else unlinkSync(p);
        }
      } else {
        mkdirSync(dest, { recursive: true });
      }

      const extractDir = join(temp, `mongodb-extract-${version}`);
      if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
      mkdirSync(extractDir, { recursive: true });
      await extractZip(zip, extractDir);
      const mongod = findFile(extractDir, "mongod.exe");
      if (!mongod) return { success: false, message: "解压失败：未找到 mongod.exe" };
      const packageRoot = dirname(dirname(mongod));
      await flattenInto(packageRoot, dest);
      try {
        unlinkSync(zip);
        rmSync(extractDir, { recursive: true, force: true });
      } catch {}
      if (savedData && existsSync(savedData) && !existsSync(join(dest, "data"))) {
        renameSafe(savedData, join(dest, "data"));
      }
      mkdirSync(join(dest, "data"), { recursive: true });

      const list = this.configStore.get("mongoVersions") || [];
      if (!list.includes(version)) {
        list.push(version);
        this.configStore.set("mongoVersions", list);
      }
      await this.pathManager.add([join(dest, "bin")], dest);
      return {
        success: true,
        message: `MongoDB ${version} 安装成功\n\n连接：mongodb://127.0.0.1:27017\n本机无认证`,
      };
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e.message}` };
    }
  }

  async uninstall() {
    try {
      await this.stop();
      const dest = this.getMongoPath();
      if (!existsSync(dest)) return { success: false, message: "MongoDB 未安装" };
      await this.pathManager.remove(dest);
      rmSync(dest, { recursive: true, force: true });
      this.configStore.set("mongoVersions", []);
      return { success: true, message: "MongoDB 已卸载" };
    } catch (e: any) {
      return { success: false, message: `卸载失败: ${e.message}` };
    }
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq mongod.exe" /NH', {
        windowsHide: true,
        timeout: 5000,
      });
      return stdout.includes("mongod.exe");
    } catch {
      return false;
    }
  }

  async start() {
    try {
      if (!existsSync(this.exe())) return { success: false, message: "MongoDB 未安装" };
      if (await this.isRunning()) return { success: true, message: "MongoDB 已经在运行" };
      const dest = this.getMongoPath();
      const data = join(dest, "data");
      const logs = this.configStore.getLogsPath();
      if (!existsSync(data)) mkdirSync(data, { recursive: true });
      if (!existsSync(logs)) mkdirSync(logs, { recursive: true });
      const logFile = join(logs, "mongodb.log");
      const vbs = join(dest, "start_mongod.vbs");
      const cmd = `"${this.exe().replace(/\\/g, "\\\\")}" --dbpath "${data.replace(/\\/g, "\\\\")}" --bind_ip 127.0.0.1 --port 27017 --logpath "${logFile.replace(/\\/g, "\\\\")}"`;
      writeFileSync(
        vbs,
        `Set WshShell = CreateObject("WScript.Shell")\nWshShell.CurrentDirectory = "${dest.replace(/\\/g, "\\\\")}"\nWshShell.Run "${cmd.replace(/"/g, '""')}", 0, False\n`,
      );
      const child = spawn("wscript.exe", [vbs], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      await new Promise((r) => setTimeout(r, 1500));
      if (await this.isRunning()) {
        return { success: true, message: "MongoDB 启动成功，端口 27017" };
      }
      return { success: false, message: "MongoDB 启动失败，请查看日志" };
    } catch (e: any) {
      return { success: false, message: `启动失败: ${e.message}` };
    }
  }

  async stop() {
    try {
      if (await this.isRunning()) {
        await execAsync("taskkill /F /IM mongod.exe", { windowsHide: true, timeout: 8000 }).catch(
          () => {},
        );
      }
      return { success: true, message: "MongoDB 已停止" };
    } catch (e: any) {
      return { success: false, message: `停止失败: ${e.message}` };
    }
  }

  async restart() {
    const s = await this.stop();
    if (!s.success) return s;
    await new Promise((r) => setTimeout(r, 600));
    return this.start();
  }

  async getStatus() {
    return { running: await this.isRunning(), port: 27017 };
  }
}

function renameSafe(src: string, dest: string) {
  try {
    rmSync(dest, { recursive: true, force: true });
  } catch {}
  const { renameSync } = require("fs");
  renameSync(src, dest);
}

async function flattenInto(src: string, dest: string) {
  const { renameSync } = require("fs");
  const items = readdirSync(src, { withFileTypes: true });
  for (const item of items) {
    const from = join(src, item.name);
    const to = join(dest, item.name);
    if (existsSync(to)) {
      if (item.isDirectory()) rmSync(to, { recursive: true, force: true });
      else unlinkSync(to);
    }
    renameSync(from, to);
  }
  try {
    rmdirSync(src);
  } catch {}
}
