<template>
  <div class="page-container">
    <div class="hero">
      <div class="hero-copy">
        <p class="hero-kicker">全局开发依赖</p>
        <h1 class="page-title hero-title">{{ APP_NAME }}</h1>
        <p class="page-description">{{ APP_TAGLINE }}</p>
      </div>
      <div class="stat-strip">
        <div class="stat">
          <div class="stat-value">{{ store.runningServiceCount }}</div>
          <div class="stat-label">服务运行中</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ installedRuntimeCount }}</div>
          <div class="stat-label">已装运行时</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ sites.length }}</div>
          <div class="stat-label">站点</div>
        </div>
      </div>
    </div>

    <section class="stack-section">
      <div class="section-header">
        <h2 class="section-title">运行时</h2>
        <p class="section-hint">语言与工具链，与后台服务并列管理</p>
      </div>
      <div class="runtime-grid">
        <router-link
          v-for="runtime in runtimes"
          :key="runtime.id"
          :to="runtime.path"
          class="runtime-card"
          :class="{ ready: runtime.installed }"
        >
          <div class="runtime-top">
            <div class="service-icon">
              <el-icon><component :is="runtime.icon" /></el-icon>
            </div>
            <el-tag v-if="runtime.installed" type="success" size="small">已安装</el-tag>
            <el-tag v-else type="info" size="small">未安装</el-tag>
          </div>
          <h3 class="service-name">{{ runtime.label }}</h3>
          <p class="runtime-meta">{{ runtime.summary }}</p>
        </router-link>
      </div>
    </section>

    <section class="stack-section">
      <div class="section-header">
        <h2 class="section-title">后台服务</h2>
        <p class="section-hint">本机依赖进程，可单独启停</p>
      </div>
      <div class="status-grid">
        <div
          v-for="service in services"
          :key="service.name"
          class="status-card"
          :class="{ running: service.running }"
        >
          <div class="status-header">
            <div class="service-icon">
              <el-icon><component :is="service.icon" /></el-icon>
            </div>
            <div class="service-info">
              <h3 class="service-name">{{ service.displayName }}</h3>
              <span class="status-tag" :class="service.running ? 'running' : 'stopped'">
                <span class="status-dot"></span>
                {{ service.running ? '运行中' : '已停止' }}
              </span>
            </div>
          </div>
          <div class="status-actions">
            <el-button
              v-if="!service.running"
              type="success"
              size="small"
              @click="startService(service)"
              :loading="service.loading"
            >
              <el-icon><VideoPlay /></el-icon>
              启动
            </el-button>
            <el-button
              v-else
              type="danger"
              size="small"
              @click="stopService(service)"
              :loading="service.loading"
            >
              <el-icon><VideoPause /></el-icon>
              停止
            </el-button>
            <el-button
              size="small"
              @click="restartService(service)"
              :loading="service.loading"
              :disabled="!service.running"
            >
              <el-icon><RefreshRight /></el-icon>
              重启
            </el-button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="phpCgiServices.length > 0" class="stack-section">
      <div class="section-header">
        <h2 class="section-title">PHP FastCGI</h2>
        <div class="section-actions">
          <el-button type="success" size="small" @click="startAllPhpCgi">
            <el-icon><VideoPlay /></el-icon>
            全部启动
          </el-button>
          <el-button type="danger" size="small" @click="stopAllPhpCgi">
            <el-icon><VideoPause /></el-icon>
            全部停止
          </el-button>
        </div>
      </div>
      <div class="status-grid">
        <div
          v-for="service in phpCgiServices"
          :key="service.name"
          class="status-card php-cgi-card"
          :class="{ running: service.running }"
        >
          <div class="status-header">
            <div class="service-icon">
              <el-icon><component :is="service.icon" /></el-icon>
            </div>
            <div class="service-info">
              <h3 class="service-name">{{ service.displayName }}</h3>
              <div class="port-info">端口: {{ service.port }}</div>
              <span class="status-tag" :class="service.running ? 'running' : 'stopped'">
                <span class="status-dot"></span>
                {{ service.running ? '运行中' : '已停止' }}
              </span>
            </div>
          </div>
          <div class="status-actions">
            <el-button
              v-if="!service.running"
              type="success"
              size="small"
              @click="startPhpCgi(service)"
              :loading="service.loading"
            >
              <el-icon><VideoPlay /></el-icon>
              启动
            </el-button>
            <el-button
              v-else
              type="danger"
              size="small"
              @click="stopPhpCgi(service)"
              :loading="service.loading"
            >
              <el-icon><VideoPause /></el-icon>
              停止
            </el-button>
            <el-button
              size="small"
              @click="restartPhpCgi(service)"
              :loading="service.loading"
              :disabled="!service.running"
            >
              <el-icon><RefreshRight /></el-icon>
              重启
            </el-button>
          </div>
        </div>
      </div>
    </section>

    <footer class="dash-footer">
      <div class="footer-col">
        <div class="footer-head">
          <h2 class="section-title">工作区</h2>
          <router-link to="/sites" class="view-more">
            管理站点 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div>
        <div v-if="sites.length > 0" class="site-list">
          <div
            v-for="site in sites.slice(0, 4)"
            :key="site.name"
            class="mini-site-card"
          >
            <a
              href="#"
              class="site-domain-link"
              @click.prevent="openSite(site)"
            >
              {{ site.domain }}
              <el-icon class="link-icon"><Link /></el-icon>
            </a>
            <div class="site-tags">
              <el-tag v-if="site.ssl" type="success" size="small">SSL</el-tag>
              <el-tag v-if="site.isLaravel" type="warning" size="small">Laravel</el-tag>
            </div>
          </div>
        </div>
        <p v-else class="footer-empty">
          暂无站点
          <router-link to="/sites">添加站点</router-link>
        </p>
      </div>

      <div class="footer-divider" aria-hidden="true"></div>

      <div class="footer-col footer-path">
        <div class="footer-head">
          <h2 class="section-title">安装路径</h2>
          <div class="section-actions">
            <el-button size="small" @click="showLogViewer = true">
              <el-icon><Document /></el-icon>
              日志
            </el-button>
            <el-button size="small" @click="openBasePath">
              <el-icon><FolderOpened /></el-icon>
              打开目录
            </el-button>
          </div>
        </div>
        <code class="path-value">{{ basePath }}</code>
      </div>
    </footer>

    <LogViewer v-model="showLogViewer" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, Document } from '@element-plus/icons-vue'
import { useServiceStore } from '@/stores/serviceStore'
import LogViewer from '@/components/LogViewer.vue'
import { APP_NAME, APP_TAGLINE } from '@/brand'

defineOptions({
  name: 'Dashboard'
})

const store = useServiceStore()

interface Service {
  name: string
  displayName: string
  icon: string
  running: boolean
  loading: boolean
  version?: string
  port?: number
}

interface RuntimeSummary {
  id: string
  label: string
  icon: string
  path: string
  installed: boolean
  summary: string
}

const extraRuntimes = ref({
  go: [] as { version: string; isActive?: boolean }[],
  python: [] as { version: string; isActive?: boolean }[],
  rust: [] as { version: string; isActive?: boolean; label?: string }[],
  java: [] as { version: string; isActive?: boolean }[],
  dotnet: [] as { version: string; isActive?: boolean }[],
  git: [] as { version: string }[],
})

const baseServiceConfigs = [
  { name: 'nginx', displayName: 'Nginx', icon: 'Connection' },
  { name: 'mysql', displayName: 'MySQL', icon: 'Coin' },
  { name: 'postgres', displayName: 'PostgreSQL', icon: 'DataBoard' },
  { name: 'redis', displayName: 'Redis', icon: 'Grid' },
  { name: 'mongodb', displayName: 'MongoDB', icon: 'Collection' },
]

const serviceLoadingState = ref<Record<string, boolean>>({})

const services = computed<Service[]>(() => {
  return baseServiceConfigs.map(config => ({
    ...config,
    running: store.serviceStatus[config.name as keyof typeof store.serviceStatus] as boolean,
    loading: serviceLoadingState.value[config.name] || false
  }))
})

const phpCgiServices = computed<Service[]>(() => {
  return store.serviceStatus.phpCgi.map(status => ({
    name: `php-cgi-${status.version}`,
    displayName: `PHP ${status.version}`,
    icon: 'Files',
    running: status.running,
    loading: serviceLoadingState.value[`php-cgi-${status.version}`] || false,
    version: status.version,
    port: status.port
  }))
})

const phpVersions = computed(() => store.phpVersions)
const nodeVersions = computed(() => store.nodeVersions)
const sites = computed(() => store.sites)
const basePath = computed(() => store.basePath)

const showLogViewer = ref(false)

function versionText(item: { version?: string; label?: string }): string {
  const raw = (item.label || item.version || "").trim()
  if (!raw || /^(no|none|unknown)$/i.test(raw)) return ""
  return raw
}

function activeOrCount(list: { version: string; isActive?: boolean; label?: string }[], unit: string) {
  if (!list.length) return '未安装'
  const active = list.find(v => v.isActive)
  const shown = versionText(active || list[0])
  if (active && shown) return `当前 ${shown}`
  if (list.length === 1 && shown) return `${unit} ${shown}`
  return `${list.length} 个已安装`
}

const runtimes = computed<RuntimeSummary[]>(() => [
  {
    id: 'php',
    label: 'PHP',
    icon: 'Files',
    path: '/php',
    installed: phpVersions.value.length > 0,
    summary: activeOrCount(phpVersions.value, 'PHP'),
  },
  {
    id: 'node',
    label: 'Node.js',
    icon: 'Promotion',
    path: '/nodejs',
    installed: nodeVersions.value.length > 0,
    summary: activeOrCount(nodeVersions.value, 'Node'),
  },
  {
    id: 'go',
    label: 'Go',
    icon: 'Aim',
    path: '/go',
    installed: extraRuntimes.value.go.length > 0,
    summary: activeOrCount(extraRuntimes.value.go, 'Go'),
  },
  {
    id: 'python',
    label: 'Python',
    icon: 'Platform',
    path: '/python',
    installed: extraRuntimes.value.python.length > 0,
    summary: activeOrCount(extraRuntimes.value.python, 'Python'),
  },
  {
    id: 'rust',
    label: 'Rust',
    icon: 'Tools',
    path: '/rust',
    installed: extraRuntimes.value.rust.length > 0,
    summary: activeOrCount(extraRuntimes.value.rust, 'Rust'),
  },
  {
    id: 'java',
    label: 'Java',
    icon: 'Coffee',
    path: '/java',
    installed: extraRuntimes.value.java.length > 0,
    summary: activeOrCount(extraRuntimes.value.java, 'JDK'),
  },
  {
    id: 'dotnet',
    label: '.NET',
    icon: 'Cpu',
    path: '/dotnet',
    installed: extraRuntimes.value.dotnet.length > 0,
    summary: activeOrCount(extraRuntimes.value.dotnet, '.NET'),
  },
  {
    id: 'git',
    label: 'Git',
    icon: 'Share',
    path: '/git',
    installed: extraRuntimes.value.git.length > 0,
    summary: extraRuntimes.value.git[0]?.version
      ? `Git ${extraRuntimes.value.git[0].version}`
      : '未安装',
  },
])

const installedRuntimeCount = computed(() => runtimes.value.filter(r => r.installed).length)

const loadExtraRuntimes = async () => {
  try {
    const [go, python, rust, java, dotnet, gitVersions, gitSystem] = await Promise.all([
      (window.electronAPI?.go.getVersions() ?? Promise.resolve([])).catch(() => []),
      (window.electronAPI?.python.getVersions() ?? Promise.resolve([])).catch(() => []),
      (window.electronAPI?.rust.getVersions() ?? Promise.resolve([])).catch(() => []),
      (window.electronAPI?.java.getVersions() ?? Promise.resolve([])).catch(() => []),
      (window.electronAPI?.dotnet.getVersions() ?? Promise.resolve([])).catch(() => []),
      (window.electronAPI?.git.getVersions() ?? Promise.resolve([])).catch(() => []),
      (window.electronAPI?.git.checkSystem() ?? Promise.resolve(null)).catch(() => null),
    ])
    extraRuntimes.value.go = go || []
    extraRuntimes.value.python = python || []
    extraRuntimes.value.rust = rust || []
    extraRuntimes.value.java = java || []
    extraRuntimes.value.dotnet = dotnet || []
    const managedGit = gitVersions || []
    if (managedGit.length > 0) {
      extraRuntimes.value.git = managedGit
    } else if (gitSystem?.installed && gitSystem.version) {
      extraRuntimes.value.git = [{ version: gitSystem.version }]
    } else {
      extraRuntimes.value.git = []
    }
  } catch (error) {
    console.error('加载运行时概览失败:', error)
  }
}

const startService = async (service: Service) => {
  serviceLoadingState.value[service.name] = true
  try {
    let result
    if (service.name === 'nginx') {
      result = await window.electronAPI?.nginx.start()
    } else if (service.name === 'mysql') {
      const versions = await window.electronAPI?.mysql.getVersions()
      if (versions?.length > 0) {
        result = await window.electronAPI?.mysql.start(versions[0].version)
      } else {
        result = { success: false, message: 'MySQL 未安装' }
      }
    } else if (service.name === 'redis') {
      result = await window.electronAPI?.redis.start()
    } else if (service.name === 'postgres') {
      result = await window.electronAPI?.postgres.start()
    } else if (service.name === 'mongodb') {
      result = await window.electronAPI?.mongodb.start()
    }

    if (result?.success) {
      store.updateServiceStatus(service.name as 'nginx' | 'mysql' | 'redis' | 'postgres' | 'mongodb', true)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[service.name] = false
  }
}

const startPhpCgi = async (service: Service) => {
  const key = `php-cgi-${service.version}`
  serviceLoadingState.value[key] = true
  try {
    const result = await window.electronAPI?.service.startPhpCgiVersion(service.version!)
    if (result?.success) {
      store.updatePhpCgiStatus(service.version!, true)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[key] = false
  }
}

const stopService = async (service: Service) => {
  serviceLoadingState.value[service.name] = true
  try {
    let result
    if (service.name === 'nginx') {
      result = await window.electronAPI?.nginx.stop()
    } else if (service.name === 'mysql') {
      const versions = await window.electronAPI?.mysql.getVersions()
      if (versions?.length > 0) {
        result = await window.electronAPI?.mysql.stop(versions[0].version)
      }
    } else if (service.name === 'redis') {
      result = await window.electronAPI?.redis.stop()
    } else if (service.name === 'postgres') {
      result = await window.electronAPI?.postgres.stop()
    } else if (service.name === 'mongodb') {
      result = await window.electronAPI?.mongodb.stop()
    }

    if (result?.success) {
      store.updateServiceStatus(service.name as 'nginx' | 'mysql' | 'redis' | 'postgres' | 'mongodb', false)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[service.name] = false
  }
}

const stopPhpCgi = async (service: Service) => {
  const key = `php-cgi-${service.version}`
  serviceLoadingState.value[key] = true
  try {
    const result = await window.electronAPI?.service.stopPhpCgiVersion(service.version!)
    if (result?.success) {
      store.updatePhpCgiStatus(service.version!, false)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[key] = false
  }
}

const restartService = async (service: Service) => {
  serviceLoadingState.value[service.name] = true
  try {
    let result
    if (service.name === 'nginx') {
      result = await window.electronAPI?.nginx.restart()
    } else if (service.name === 'mysql') {
      const versions = await window.electronAPI?.mysql.getVersions()
      if (versions?.length > 0) {
        result = await window.electronAPI?.mysql.restart(versions[0].version)
      }
    } else if (service.name === 'redis') {
      result = await window.electronAPI?.redis.restart()
    } else if (service.name === 'postgres') {
      result = await window.electronAPI?.postgres.restart()
    } else if (service.name === 'mongodb') {
      result = await window.electronAPI?.mongodb.restart()
    }

    if (result?.success) {
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '重启失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[service.name] = false
  }
}

const restartPhpCgi = async (service: Service) => {
  const key = `php-cgi-${service.version}`
  serviceLoadingState.value[key] = true
  try {
    await window.electronAPI?.service.stopPhpCgiVersion(service.version!)
    await new Promise(resolve => setTimeout(resolve, 500))
    const result = await window.electronAPI?.service.startPhpCgiVersion(service.version!)
    if (result?.success) {
      store.updatePhpCgiStatus(service.version!, true)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '重启失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[key] = false
  }
}

const startAllPhpCgi = async () => {
  try {
    const result = await window.electronAPI?.service.startAllPhpCgi()
    if (result?.success) {
      ElMessage.success('全部 PHP-CGI 已启动')
      store.serviceStatus.phpCgi.forEach(p => p.running = true)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

const stopAllPhpCgi = async () => {
  try {
    const result = await window.electronAPI?.service.stopAllPhpCgi()
    if (result?.success) {
      ElMessage.success('全部 PHP-CGI 已停止')
      store.serviceStatus.phpCgi.forEach(p => p.running = false)
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

const openBasePath = async () => {
  if (basePath.value) {
    await window.electronAPI?.openPath(basePath.value)
  }
}

const openSite = (site: { domain: string, ssl: boolean }) => {
  const protocol = site.ssl ? 'https' : 'http'
  window.electronAPI?.openExternal(`${protocol}://${site.domain}`)
}

onMounted(async () => {
  if (store.phpVersions.length === 0 && store.nodeVersions.length === 0) {
    await store.refreshAll()
  }
  await loadExtraRuntimes()
})

onActivated(async () => {
  await store.refreshServiceStatus()
  await loadExtraRuntimes()
})
</script>

<style lang="scss" scoped>
.page-container {
  padding-bottom: 48px;
}

.hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-color);
}

.hero-kicker {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-color);
  margin-bottom: 6px;
}

.hero-title {
  font-size: 26px;
  margin-bottom: 6px;
}

.stat-strip {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.stat {
  min-width: 92px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
}

.stack-section {
  margin-bottom: 22px;
}

.dash-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1px minmax(280px, 0.72fr);
  gap: 0;
  margin-top: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.footer-col {
  min-width: 0;
  padding: 14px 16px 16px;
}

.footer-path {
  background: var(--bg-input);
}

.footer-divider {
  background: var(--border-color);
}

.footer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.footer-empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);

  a {
    color: var(--accent-color);
    margin-left: 8px;
    text-decoration: none;
    &:hover { text-decoration: underline; }
  }
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
}

.section-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.section-actions {
  display: flex;
  gap: 6px;
}

.runtime-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.runtime-card {
  display: block;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 14px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
  transition: background var(--transition-fast);

  &:hover { background: var(--bg-hover); }
  &.ready {
    background: var(--select-fill);
  }
}

.runtime-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.runtime-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.status-card {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  padding: 14px;
  min-width: 0;
  transition: background var(--transition-fast);

  &:hover { background: var(--bg-hover); }

  &.running {
    background: var(--select-fill);
  }

  .status-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .status-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
}

.service-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: var(--bg-input);
  border: none;
  color: var(--text-secondary);
}

.service-info {
  .service-name {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 2px;
  }
}

.service-name {
  font-size: 15px;
  font-weight: 600;
}

.site-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mini-site-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);

  &:last-child { border-bottom: none; padding-bottom: 0; }

  .site-domain-link {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    font-family: 'Fira Code', monospace;
    color: var(--accent-color);
    text-decoration: none;

    .link-icon {
      font-size: 12px;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    &:hover {
      text-decoration: underline;
      .link-icon { opacity: 1; }
    }
  }

  .site-tags {
    display: flex;
    gap: 6px;
  }
}

.view-more {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--accent-color);
  text-decoration: none;
  font-size: 13px;

  &:hover { text-decoration: underline; }
}

.path-value {
  display: block;
  font-family: 'Fira Code', monospace;
  font-size: 12px;
  color: var(--accent-color);
  word-break: break-all;
  line-height: 1.5;
}

@media (max-width: 1180px) {
  .runtime-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash-footer { grid-template-columns: 1fr; }
  .footer-divider { display: none; }
}

@media (max-width: 820px) {
  .hero { flex-direction: column; align-items: stretch; }
  .runtime-grid,
  .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.php-cgi-card {
  .port-info {
    font-size: 11px;
    color: var(--text-muted);
    font-family: 'Fira Code', monospace;
    margin-bottom: 2px;
  }
}
</style>
