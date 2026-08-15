<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Collection /></el-icon></span>
        MongoDB 管理
      </h1>
      <p class="page-description">安装并管理本机 MongoDB Community，版本来自官网 current.json</p>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">服务状态</span>
        <el-button v-if="!currentVersion" type="primary" @click="openInstall">安装 MongoDB</el-button>
      </div>
      <div class="card-content">
        <div v-if="loading" class="loading-state"><el-icon class="is-loading"><Loading /></el-icon>加载中...</div>
        <el-empty v-else-if="!currentVersion" description="暂未安装 MongoDB" />
        <div v-else class="service-row">
          <div>
            <div class="name">MongoDB {{ currentVersion }}</div>
            <div class="meta">{{ status.running ? '运行中' : '已停止' }} · mongodb://127.0.0.1:27017</div>
            <div class="path">{{ installedPath }}</div>
          </div>
          <div class="actions">
            <el-button v-if="!status.running" type="success" @click="start" :loading="busy">启动</el-button>
            <el-button v-else type="warning" @click="stop" :loading="busy">停止</el-button>
            <el-button @click="restart" :loading="busy" :disabled="!status.running">重启</el-button>
            <el-button @click="openInstall">切换版本</el-button>
            <el-button type="danger" plain @click="uninstall" :disabled="status.running">卸载</el-button>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="showInstallDialog" title="安装 MongoDB" width="600px">
      <el-alert type="info" :closable="false" class="mb-4">
        从 <a href="https://www.mongodb.com/try/download/community" target="_blank">MongoDB 官网</a> current.json 获取 Windows x64 zip。
      </el-alert>
      <div v-if="loadingAvailable" class="loading-state"><el-icon class="is-loading"><Loading /></el-icon>正在获取版本...</div>
      <div v-else class="version-list">
        <div v-for="v in availableVersions" :key="v.version" class="version-item" :class="{ selected: selectedVersion === v.version }" @click="selectedVersion = v.version">
          MongoDB {{ v.version }}
        </div>
      </div>
      <div v-if="installing && downloadProgress.total > 0" class="download-progress">
        <div class="progress-info">
          <span>下载中...</span>
          <span>{{ formatSize(downloadProgress.downloaded) }} / {{ formatSize(downloadProgress.total) }}</span>
        </div>
        <el-progress :percentage="downloadProgress.progress" :stroke-width="10" />
      </div>
      <template #footer>
        <el-button @click="showInstallDialog = false" :disabled="installing">取消</el-button>
        <el-button type="primary" :loading="installing" :disabled="!selectedVersion" @click="install">安装</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Collection, Loading } from "@element-plus/icons-vue";

defineOptions({ name: "MongoManager" });

const loading = ref(false);
const busy = ref(false);
const installing = ref(false);
const loadingAvailable = ref(false);
const showInstallDialog = ref(false);
const currentVersion = ref("");
const installedPath = ref("");
const selectedVersion = ref("");
const availableVersions = ref<{ version: string; downloadUrl: string }[]>([]);
const status = ref({ running: false, port: 27017 });
const downloadProgress = reactive({ progress: 0, downloaded: 0, total: 0 });

const refresh = async () => {
  loading.value = true;
  try {
    const list = (await window.electronAPI?.mongodb.getVersions()) || [];
    currentVersion.value = list[0]?.version || "";
    installedPath.value = list[0]?.path || "";
    status.value = (await window.electronAPI?.mongodb.getStatus()) || { running: false, port: 27017 };
  } finally {
    loading.value = false;
  }
};

const openInstall = async () => {
  showInstallDialog.value = true;
  loadingAvailable.value = true;
  try {
    availableVersions.value = (await window.electronAPI?.mongodb.getAvailableVersions()) || [];
    if (availableVersions.value[0]) selectedVersion.value = availableVersions.value[0].version;
  } finally {
    loadingAvailable.value = false;
  }
};

const install = async () => {
  installing.value = true;
  try {
    const result = await window.electronAPI?.mongodb.install(selectedVersion.value);
    if (result?.success) {
      ElMessage.success(result.message);
      showInstallDialog.value = false;
      await refresh();
    } else ElMessage.error(result?.message || "安装失败");
  } finally {
    installing.value = false;
  }
};

const uninstall = async () => {
  await ElMessageBox.confirm("确定卸载 MongoDB？数据目录会一并删除。", "确认卸载", { type: "warning" });
  const result = await window.electronAPI?.mongodb.uninstall();
  if (result?.success) {
    ElMessage.success(result.message);
    await refresh();
  } else ElMessage.error(result?.message || "卸载失败");
};

const start = async () => {
  busy.value = true;
  try {
    const result = await window.electronAPI?.mongodb.start();
    result?.success ? ElMessage.success(result.message) : ElMessage.error(result?.message || "启动失败");
    await refresh();
  } finally { busy.value = false; }
};
const stop = async () => {
  busy.value = true;
  try {
    const result = await window.electronAPI?.mongodb.stop();
    result?.success ? ElMessage.success(result.message) : ElMessage.error(result?.message || "停止失败");
    await refresh();
  } finally { busy.value = false; }
};
const restart = async () => {
  busy.value = true;
  try {
    const result = await window.electronAPI?.mongodb.restart();
    result?.success ? ElMessage.success(result.message) : ElMessage.error(result?.message || "重启失败");
    await refresh();
  } finally { busy.value = false; }
};

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const onDownloadProgress = (data: any) => {
  if (data.type === "mongodb") {
    downloadProgress.progress = data.progress;
    downloadProgress.downloaded = data.downloaded;
    downloadProgress.total = data.total;
  }
};

onMounted(() => {
  refresh();
  window.electronAPI?.onDownloadProgress(onDownloadProgress);
});
onUnmounted(() => window.electronAPI?.removeDownloadProgressListener(onDownloadProgress));
</script>

<style lang="scss" scoped>
.service-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap; }
.name { font-size: 16px; font-weight: 600; }
.meta { margin-top: 4px; color: var(--text-secondary); font-size: 13px; }
.path { margin-top: 4px; color: var(--text-muted); font-size: 12px; word-break: break-all; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.version-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow: auto; }
.version-item { padding: 10px 12px; border-radius: var(--radius-md); cursor: pointer; border: 1px solid var(--border-color);
  &.selected, &:hover { background: var(--select-fill); }
}
.loading-state { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 28px; color: var(--text-secondary); }
.download-progress { margin-top: 16px; }
.progress-info { display: flex; justify-content: space-between; margin-bottom: 8px; color: var(--text-secondary); }
.mb-4 { margin-bottom: 16px; a { color: var(--accent-color); } }
</style>
