<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Cpu /></el-icon></span>
        .NET 管理
      </h1>
      <p class="page-description">从 Microsoft 官方源安装 .NET SDK，支持多版本切换</p>
    </div>

    <div v-if="downloadProgress.percent > 0 && downloadProgress.percent < 100" class="download-progress">
      <div class="progress-info">
        <span>正在下载 .NET SDK...</span>
        <span>{{ formatSize(downloadProgress.downloaded) }} / {{ formatSize(downloadProgress.total) }}</span>
      </div>
      <el-progress :percentage="downloadProgress.percent" :stroke-width="10" />
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">已安装版本</span>
        <el-button type="primary" @click="showInstallDialog = true">
          <el-icon><Plus /></el-icon>
          安装新版本
        </el-button>
      </div>
      <div class="card-content">
        <div v-if="versions.length > 0" class="version-grid">
          <div v-for="version in versions" :key="version.version + version.path" class="version-card" :class="{ active: version.isActive }">
            <div class="version-main">
              <div class="version-icon"><el-icon><Cpu /></el-icon></div>
              <div class="version-content">
                <div class="version-title">
                  <span class="version-number">.NET {{ version.version }}</span>
                  <el-tag v-if="version.isActive" type="success" size="small" effect="dark">当前版本</el-tag>
                  <el-tag v-if="version.source === 'system'" type="warning" size="small" effect="plain">系统安装</el-tag>
                </div>
                <div class="version-path">{{ version.path }}</div>
              </div>
            </div>
            <div class="version-actions">
              <el-button v-if="!version.isActive" type="primary" size="small" @click="setActiveVersion(version)" :loading="settingActive === version.version">设为默认</el-button>
              <el-button type="danger" size="small" plain @click="uninstallVersion(version)" :loading="uninstalling === version.version">卸载</el-button>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂未安装 .NET SDK" />
      </div>
    </div>

    <el-dialog v-model="showInstallDialog" title="安装 .NET SDK" width="720px">
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title><el-icon><InfoFilled /></el-icon> 下载源说明</template>
        从 Microsoft 官方 release-metadata 获取当前支持通道的最新 SDK zip。
      </el-alert>
      <div v-if="loadingAvailableVersions" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>正在获取可用版本列表...</span>
      </div>
      <el-table v-else :data="availableVersions" max-height="400">
        <el-table-column prop="version" label="SDK" width="160" />
        <el-table-column prop="channel" label="通道" width="100" />
        <el-table-column label="支持" width="120">
          <template #default="{ row }">
            <el-tag size="small">{{ row.support }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button v-if="!isInstalled(row.version)" type="primary" size="small" @click="installVersion(row)" :loading="installing === row.version">安装</el-button>
            <el-tag v-else type="info" size="small">已安装</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="showInstallDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Cpu, InfoFilled, Loading } from "@element-plus/icons-vue";

defineOptions({ name: "DotnetManager" });

interface DotnetVersion {
  version: string;
  path: string;
  isActive: boolean;
  source?: "managed" | "system";
}
interface AvailableDotnetVersion {
  version: string;
  channel: string;
  support: string;
  downloadUrl: string;
}

const versions = ref<DotnetVersion[]>([]);
const availableVersions = ref<AvailableDotnetVersion[]>([]);
const showInstallDialog = ref(false);
const installing = ref("");
const uninstalling = ref("");
const settingActive = ref("");
const loadingAvailableVersions = ref(false);
const downloadProgress = reactive({ percent: 0, downloaded: 0, total: 0 });

const loadVersions = async () => {
  versions.value = (await window.electronAPI?.dotnet.getVersions()) || [];
};
const loadAvailableVersions = async () => {
  loadingAvailableVersions.value = true;
  try {
    availableVersions.value = (await window.electronAPI?.dotnet.getAvailableVersions()) || [];
  } finally {
    loadingAvailableVersions.value = false;
  }
};
const isInstalled = (version: string) => versions.value.some((v) => v.version === version);

const installVersion = async (row: AvailableDotnetVersion) => {
  installing.value = row.version;
  downloadProgress.percent = 0;
  try {
    const result = await window.electronAPI?.dotnet.install(row.version, row.downloadUrl);
    if (result?.success) {
      ElMessage.success(result.message);
      await loadVersions();
    } else ElMessage.error(result?.message || "安装失败");
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    installing.value = "";
    downloadProgress.percent = 0;
  }
};

const uninstallVersion = async (version: DotnetVersion) => {
  try {
    if (version.source === "system") {
      await ElMessageBox.confirm(`即将删除系统 .NET 目录：\n${version.path}`, "危险操作", { type: "error" });
      uninstalling.value = version.version;
      const result = await window.electronAPI?.dotnet.uninstallSystem(version.path);
      if (result?.success) {
        ElMessage.success(result.message);
        await loadVersions();
      } else ElMessage.error(result?.message || "卸载失败");
      return;
    }
    await ElMessageBox.confirm(`确定卸载 .NET ${version.version} 吗？`, "确认卸载", { type: "warning" });
    uninstalling.value = version.version;
    const result = await window.electronAPI?.dotnet.uninstall(version.version);
    if (result?.success) {
      ElMessage.success(result.message);
      await loadVersions();
    } else ElMessage.error(result?.message || "卸载失败");
  } catch (e: any) {
    if (e !== "cancel") ElMessage.error(e.message);
  } finally {
    uninstalling.value = "";
  }
};

const setActiveVersion = async (version: DotnetVersion) => {
  settingActive.value = version.version;
  try {
    const result =
      version.source === "system"
        ? await window.electronAPI?.dotnet.setActiveSystem(version.path)
        : await window.electronAPI?.dotnet.setActive(version.version);
    if (result?.success) {
      ElMessage.success(result.message);
      await loadVersions();
    } else ElMessage.error(result?.message || "设置失败");
  } finally {
    settingActive.value = "";
  }
};

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

const onDownloadProgress = (data: any) => {
  if (data.type === "dotnet") {
    downloadProgress.percent = data.progress;
    downloadProgress.downloaded = data.downloaded;
    downloadProgress.total = data.total;
  }
};

onMounted(() => {
  loadVersions();
  loadAvailableVersions();
  window.electronAPI?.onDownloadProgress(onDownloadProgress);
});
onUnmounted(() => window.electronAPI?.removeDownloadProgressListener(onDownloadProgress));
</script>

<style lang="scss" scoped>
.version-grid { display: flex; flex-direction: column; gap: 8px; }
.version-card {
  background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);
  padding: 12px 14px; display: flex; align-items: center; gap: 16px;
  &.active { background: var(--select-fill); }
}
.version-main { display: flex; align-items: flex-start; gap: 16px; flex: 1; min-width: 0; }
.version-icon { width: 36px; height: 36px; border-radius: var(--radius-md); background: var(--bg-input); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); flex-shrink: 0; }
.version-title { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
.version-number { font-size: 15px; font-weight: 600; }
.version-path { font-size: 12px; color: var(--text-muted); word-break: break-all; }
.version-actions { display: flex; gap: 8px; flex-shrink: 0; }
.download-progress { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; margin-bottom: 20px; }
.progress-info { display: flex; justify-content: space-between; margin-bottom: 8px; color: var(--text-secondary); }
.loading-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 40px; color: var(--text-secondary); }
.mb-4 { margin-bottom: 16px; a { color: var(--accent-color); } }
</style>
