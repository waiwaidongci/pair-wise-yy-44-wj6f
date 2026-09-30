<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useWorkshopStore } from './stores/workshop'
import { ROLE_COLORS, ROLE_LABELS, type Role } from './lib/merge'

const route = useRoute()
const store = useWorkshopStore()
const mobileOpen = ref(false)
const title = computed(() => String(route.meta.title ?? '巡演舞台'))

const nav = [
  { to: '/', label: '巡演总览', icon: '总' },
  { to: '/stage', label: '舞台走位', icon: '图' },
  { to: '/script', label: '排练脚本', icon: '序' },
  { to: '/sync', label: '离线协同', icon: '协' },
  { to: '/print', label: '打印中心', icon: '印' },
]

const roleOptions: Role[] = ['stage-manager', 'foh-director']
</script>

<template>
  <div class="shell">
    <header class="mobile-bar">
      <button class="menu-button" aria-label="切换导航" @click="mobileOpen = !mobileOpen">菜单</button>
      <strong>{{ title }}</strong>
      <span class="mobile-status">{{ store.isOffline ? '离线' : '在线' }}</span>
    </header>

    <aside class="sidebar" :class="{ open: mobileOpen }">
      <div class="brand">
        <div class="brand-mark">巡演</div>
        <div>
          <strong>舞台执行中心</strong>
          <small>《潮汐来信》2026 巡演</small>
        </div>
      </div>

      <nav class="nav-list">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          @click="mobileOpen = false"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="side-card">
        <div class="side-card-title">
          <span class="status-dot" :style="{ background: store.isOffline ? '#d99a2b' : '#45a878' }" />
          {{ store.isOffline ? '离线草稿已保存' : '协作服务正常' }}
        </div>
        <p>版本 {{ store.revision }} · {{ store.lastSaved }}</p>
        <div v-if="store.halted" class="side-halt">互锁差异待核，基线停住</div>
        <div v-if="store.hasRevisionDraft" class="side-draft">修订稿 {{ store.revision }}（草稿）</div>
        <div class="side-roles">
          <button
            v-for="role in roleOptions"
            :key="role"
            class="side-role"
            :class="{ active: store.activeRole === role }"
            :style="store.activeRole === role ? { background: ROLE_COLORS[role], borderColor: ROLE_COLORS[role] } : {}"
            @click="store.setRole(role)"
          >
            {{ ROLE_LABELS[role] }}
          </button>
        </div>
        <button class="ghost-button" @click="store.toggleOffline">
          {{ store.isOffline ? '恢复连接并合并' : '模拟离线' }}
        </button>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
  background: #eef2f4;
}

.sidebar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  width: 246px;
  height: 100vh;
  flex: 0 0 246px;
  flex-direction: column;
  padding: 20px 14px;
  color: #dfeaf0;
  background: #102231;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 8px 20px;
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid #58aeb4;
  border-radius: 9px;
  color: #a9e5df;
  font-size: 13px;
  font-weight: 800;
}

.brand strong,
.brand small {
  display: block;
}

.brand small {
  margin-top: 4px;
  color: #8fa5b5;
  font-size: 11px;
}

.nav-list {
  display: grid;
  gap: 5px;
  padding: 18px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 7px;
  color: #b9c9d3;
  text-decoration: none;
}

.nav-item.router-link-active {
  color: #fff;
  background: #1d3c4b;
  box-shadow: inset 3px 0 #54b6b4;
}

.nav-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 6px;
  font-size: 11px;
}

.side-card {
  margin-top: auto;
  padding: 13px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 9px;
  background: rgb(255 255 255 / 4%);
}

.side-card-title {
  font-size: 12px;
  font-weight: 700;
}

.side-card p {
  margin: 8px 0 11px;
  color: #9eb0bc;
  font-size: 11px;
}

.ghost-button {
  width: 100%;
  padding: 8px;
  border: 1px solid #426172;
  border-radius: 6px;
  color: #d9e4e9;
  background: transparent;
  cursor: pointer;
}

.side-halt,
.side-draft {
  margin: 6px 0;
  padding: 6px 8px;
  border-radius: 5px;
  font-size: 11px;
}

.side-halt {
  color: #f0c6b8;
  background: rgb(217 154 43 / 18%);
}

.side-draft {
  color: #bfe3dd;
  background: rgb(47 133 128 / 18%);
}

.side-roles {
  display: flex;
  gap: 6px;
  margin: 8px 0;
}

.side-role {
  flex: 1;
  padding: 6px 4px;
  border: 1px solid #426172;
  border-radius: 6px;
  color: #b9c9d3;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.side-role.active {
  color: #fff;
}

.content {
  min-width: 0;
  flex: 1;
}

.mobile-bar {
  display: none;
}

@media (max-width: 860px) {
  .shell {
    display: block;
  }

  .mobile-bar {
    position: sticky;
    top: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 8px 12px;
    color: #fff;
    background: #102231;
  }

  .menu-button {
    padding: 6px 10px;
    border: 1px solid #426172;
    border-radius: 6px;
    color: #fff;
    background: transparent;
  }

  .mobile-status {
    color: #9fd3ce;
    font-size: 12px;
  }

  .sidebar {
    position: fixed;
    top: 52px;
    bottom: 0;
    left: -270px;
    height: auto;
    transition: left 180ms ease;
  }

  .sidebar.open {
    left: 0;
  }
}
</style>
