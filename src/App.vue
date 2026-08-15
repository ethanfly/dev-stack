<template>
  <div class="app-container">
    <div class="title-bar">
      <div class="title-bar-left">
        <div class="app-logo">
          <img src="/icon.png" alt="" class="logo-icon" />
          <span class="app-name">{{ APP_NAME }}</span>
        </div>
        <span class="title-tagline">{{ APP_TAGLINE }}</span>
      </div>
      <div class="title-bar-right">
        <button class="theme-toggle" @click="toggleDark" :title="isDark ? '切换浅色' : '切换深色'">
          <svg v-if="isDark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
        <button class="win-btn" @click="minimize" title="最小化">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
        <button class="win-btn" @click="maximize" title="最大化">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.7" y="0.7" width="8.6" height="8.6" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button class="win-btn win-close" @click="close" title="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>

    <div class="main-container">
      <aside class="sidebar">
        <div class="sidebar-status-bar">
          <span class="live-dot" :class="{ on: store.runningServiceCount > 0 }"></span>
          <span>{{ store.runningServiceCount }} 个依赖在运行</span>
        </div>

        <nav class="nav-menu">
          <template v-for="(group, idx) in navGroups" :key="idx">
            <div class="nav-group-label">{{ group.label }}</div>
            <router-link
              v-for="item in group.items"
              :key="item.path"
              :to="item.path"
              class="nav-item"
              :class="{ active: $route.path === item.path }"
            >
              <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
              <span class="nav-label">{{ item.label }}</span>
              <span
                v-if="item.service"
                class="status-dot"
                :class="{ running: serviceStatus[item.service as keyof typeof serviceStatus] }"
              ></span>
            </router-link>
          </template>
        </nav>

        <div class="sidebar-footer">
          <button class="action-btn start-btn" :disabled="startingAll" @click="startAll">
            ▶ 启动全部服务
          </button>
          <button class="action-btn stop-btn" :disabled="stoppingAll" @click="stopAll">
            ■ 停止全部服务
          </button>
        </div>
      </aside>

      <main class="content">
        <router-view v-slot="{ Component, route }">
          <keep-alive :include="cachedViews">
            <component :is="Component" :key="route.path" />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted, onUnmounted } from "vue";
  import { ElMessage } from "element-plus";
  import { useServiceStore } from "./stores/serviceStore";
  import { APP_NAME, APP_TAGLINE } from "./brand";

  const store = useServiceStore();

  const isDark = ref(true);
  const startingAll = ref(false);
  const stoppingAll = ref(false);

  const cachedViews = [
    "Dashboard", "PhpManager", "MysqlManager", "NginxManager",
    "RedisManager", "NodeManager", "GoManager", "PythonManager",
    "RustManager", "GitManager", "JavaManager", "DotnetManager",
    "PostgresManager", "MongoManager", "SitesManager", "HostsManager", "Settings",
  ];

  const serviceStatus = computed(() => ({
    nginx: store.serviceStatus.nginx,
    mysql: store.serviceStatus.mysql,
    redis: store.serviceStatus.redis,
    postgres: store.serviceStatus.postgres,
    mongodb: store.serviceStatus.mongodb,
  }));

  const navGroups = [
    {
      label: "总览",
      items: [
        { path: "/", label: "仪表盘", icon: "Odometer", service: null },
      ],
    },
    {
      label: "运行时",
      items: [
        { path: "/php", label: "PHP", icon: "Files", service: null },
        { path: "/nodejs", label: "Node.js", icon: "Promotion", service: null },
        { path: "/go", label: "Go", icon: "Aim", service: null },
        { path: "/python", label: "Python", icon: "Platform", service: null },
        { path: "/rust", label: "Rust", icon: "Tools", service: null },
        { path: "/java", label: "Java", icon: "Coffee", service: null },
        { path: "/dotnet", label: ".NET", icon: "Cpu", service: null },
        { path: "/git", label: "Git", icon: "Share", service: null },
      ],
    },
    {
      label: "服务",
      items: [
        { path: "/mysql", label: "MySQL", icon: "Coin", service: "mysql" },
        { path: "/postgres", label: "PostgreSQL", icon: "DataBoard", service: "postgres" },
        { path: "/nginx", label: "Nginx", icon: "Connection", service: "nginx" },
        { path: "/redis", label: "Redis", icon: "Grid", service: "redis" },
        { path: "/mongodb", label: "MongoDB", icon: "Collection", service: "mongodb" },
      ],
    },
    {
      label: "工作区",
      items: [
        { path: "/sites", label: "站点", icon: "Monitor", service: null },
        { path: "/hosts", label: "Hosts", icon: "Document", service: null },
        { path: "/settings", label: "设置", icon: "Setting", service: null },
      ],
    },
  ];

  let statusInterval: ReturnType<typeof setInterval> | null = null;

  const minimize = () => window.electronAPI?.minimize();
  const maximize = () => window.electronAPI?.maximize();
  const close = () => window.electronAPI?.close();

  const toggleDark = () => {
    isDark.value = !isDark.value;
    document.documentElement.classList.toggle("dark", isDark.value);
  };

  const startAll = async () => {
    startingAll.value = true;
    try {
      const result = await window.electronAPI?.service.startAll();
      if (result?.success) {
        ElMessage.success(result.message);
        setTimeout(() => store.refreshServiceStatus(), 2000);
      } else {
        ElMessage.error(result?.message || "启动失败");
      }
    } catch (error: any) {
      ElMessage.error(error.message);
    } finally {
      startingAll.value = false;
    }
  };

  const stopAll = async () => {
    stoppingAll.value = true;
    try {
      const result = await window.electronAPI?.service.stopAll();
      if (result?.success) {
        ElMessage.success(result.message);
        await store.refreshServiceStatus();
      } else {
        ElMessage.error(result?.message || "停止失败");
      }
    } catch (error: any) {
      ElMessage.error(error.message);
    } finally {
      stoppingAll.value = false;
    }
  };

  onMounted(() => {
    document.title = APP_NAME;
    document.documentElement.classList.add("dark");
    store.refreshAll();
    statusInterval = setInterval(() => store.refreshServiceStatus(), 5000);
  });

  onUnmounted(() => {
    if (statusInterval) clearInterval(statusInterval);
  });
</script>

<style lang="scss" scoped>
  .app-container {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    color: var(--text-primary);
    overflow: hidden;
  }

  .title-bar-right {
    display: flex;
    align-items: stretch;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .theme-toggle {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border-color);
    color: var(--text-muted);
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    padding: 0;
    outline: none;

    &:hover { background: var(--bg-hover); color: var(--text-primary); }
  }

  .win-btn {
    width: 46px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-left: 1px solid var(--border-color);
    color: var(--text-muted);
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    padding: 0;
    outline: none;

    svg { transition: color 80ms ease; }

    &:hover { background: var(--bg-hover); color: var(--text-primary); }
  }

  .win-close {
    &:hover { background: #e81123 !important; color: #fff !important; }
  }

  .title-bar {
    height: 38px;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--border-color);
    -webkit-app-region: drag;
    padding-left: 14px;
    flex-shrink: 0;
    user-select: none;
  }

  .title-bar-left {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .app-logo {
    display: flex;
    align-items: center;
    gap: 8px;

    .logo-icon {
      width: 20px;
      height: 20px;
    }

    .app-name {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: 0.02em;
    }
  }

  .title-tagline {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 420px;
  }

  .main-container {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .sidebar {
    width: 228px;
    min-width: 228px;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
  }

  .sidebar-status-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px 8px;
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);

    &.on {
      background: var(--success-color);
      box-shadow: 0 0 6px rgba(52, 211, 153, 0.45);
    }
  }

  .nav-menu {
    flex: 1;
    overflow-y: auto;
    padding: 8px 8px 12px;
  }

  .nav-group-label {
    padding: 12px 10px 6px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    margin-bottom: 2px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 450;
    border: none;
    transition: background 120ms ease, color 120ms ease;

    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    &.active {
      color: var(--text-primary);
      background: var(--select-fill);

      .nav-icon { color: var(--accent-color); }
    }

    .nav-icon {
      font-size: 16px;
      color: var(--text-muted);
      flex-shrink: 0;
      transition: color 120ms ease;
    }

    &:hover .nav-icon { color: var(--text-secondary); }

    .nav-label { flex: 1; white-space: nowrap; }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-muted);
      border: 1.5px solid var(--bg-sidebar);
      flex-shrink: 0;
      transition: all var(--transition-normal);

      &.running {
        background: var(--success-color);
        box-shadow: 0 0 6px rgba(52, 211, 153, 0.4);
      }
    }
  }

  .sidebar-footer {
    padding: 8px;
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .action-btn {
    display: block;
    width: 100%;
    height: 30px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    padding: 0;
    outline: none;
    transition: all 120ms ease;
    text-align: center;
    line-height: 28px;

    &:disabled { opacity: 0.5; cursor: not-allowed; }
    &.start-btn:hover:not(:disabled) { border-color: var(--success-border); color: var(--success-color); background: var(--success-bg); }
    &.stop-btn:hover:not(:disabled) { border-color: var(--error-border); color: var(--error-color); background: var(--error-bg); }
  }

  .content {
    flex: 1;
    padding: 24px 28px;
    overflow-y: auto;
    background: var(--bg-content);
  }
</style>
