<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useWorkshopStore } from '../stores/workshop'
import { ROLE_COLORS, ROLE_LABELS, type FieldDiff, type OfflineOp, type Role } from '../lib/merge'

const store = useWorkshopStore()
const {
  activeRole,
  isOffline,
  pendingOps,
  pendingDiffs,
  interlockDiffs,
  halted,
  mergeResults,
  mergeLog,
  forceMergeFailure,
  revision,
  hasRevisionDraft,
} = storeToRefs(store)

const roleOptions: Role[] = ['stage-manager', 'foh-director']

const fieldLabels: Record<string, string> = {
  entry: '入场点',
  exit: '退场点',
  time: '触发时间',
  title: '提示标题',
  scene: '场景',
  department: '执行部门',
  owner: '责任角色',
  note: '执行说明',
  duration: '时长',
  act: '幕次',
  status: '状态',
  route: '路线',
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    if (Array.isArray(value)) return `路线 ${value.length} 节点`
    const point = value as { x?: number; y?: number }
    if (typeof point.x === 'number' && typeof point.y === 'number') return `(${point.x}, ${point.y})`
    return JSON.stringify(value)
  }
  return String(value)
}

function opSummary(op: OfflineOp): string {
  const parts: string[] = []
  for (const field of Object.keys(op.fields)) parts.push(fieldLabels[field] ?? field)
  if (Object.keys(op.routeNodes).length) parts.push('路线节点')
  if (op.routeAppends.length) parts.push(`路线追加 ${op.routeAppends.length}`)
  if (op.commentAppends.length) parts.push(`留言 ${op.commentAppends.length}`)
  return parts.length ? parts.join(' · ') : '无变更'
}

function diffLabel(diff: FieldDiff): string {
  if (diff.field === 'route' && diff.nodeIndex !== undefined) return `路线节点 ${diff.nodeIndex}`
  return fieldLabels[diff.field] ?? diff.field
}

function diffValue(diff: FieldDiff, side: 'local' | 'remote'): string {
  return formatValue(side === 'local' ? diff.localValue : diff.remoteValue)
}

function roleTagType(role: Role) {
  return role === 'stage-manager' ? 'primary' : 'warning'
}

function goOffline() {
  store.goOffline()
  ElMessage.info('已进入离线模式，可在舞台走位中编辑')
}

function goOnline() {
  store.goOnline()
}

function retry() {
  store.retryMerge()
}

function resolve(diff: FieldDiff, choice: 'local' | 'remote') {
  const cueId = findCueId(diff)
  if (!cueId) return
  store.resolveDiff(cueId, diff.field, diff.nodeIndex, choice)
}

function findCueId(diff: FieldDiff): string | undefined {
  for (const result of mergeResults.value) {
    if (result.diffs.includes(diff)) return result.cueId
  }
  return undefined
}

const failedCount = computed(() => pendingOps.value.filter((op) => op.status === 'failed').length)
</script>

<template>
  <section class="panel sync-panel">
    <div class="panel-head">
      <h3>离线协同合并</h3>
      <span class="muted">断网终端各自保存，联网后按提示编号合并</span>
    </div>

    <div class="sync-roles">
      <span class="sync-label">当前终端角色</span>
      <div class="role-switch">
        <button
          v-for="role in roleOptions"
          :key="role"
          class="role-btn"
          :class="{ active: activeRole === role }"
          :style="activeRole === role ? { background: ROLE_COLORS[role], borderColor: ROLE_COLORS[role] } : {}"
          @click="store.setRole(role)"
        >
          {{ ROLE_LABELS[role] }}
        </button>
      </div>
    </div>

    <div class="sync-network">
      <span class="status-dot" :style="{ background: isOffline ? '#d99a2b' : '#45a878' }" />
      <strong>{{ isOffline ? '离线编辑中' : '协作服务在线' }}</strong>
      <span class="muted">{{ isOffline ? '本机保存，联网后合并' : '操作将直接并入基线' }}</span>
      <el-button size="small" :type="isOffline ? 'primary' : 'default'" @click="isOffline ? goOnline() : goOffline()">
        {{ isOffline ? '恢复网络并合并' : '模拟断网' }}
      </el-button>
    </div>

    <el-alert
      v-if="halted"
      class="halt-banner"
      type="error"
      show-icon
      :closable="false"
      title="演出基线已停住"
      :description="`${interlockDiffs.length} 项差异影响互锁判断，打印中心保留旧版清单。请处理下方互锁差异后再并入基线。`"
    >
      <div class="halt-actions">
        <el-button size="small" @click="store.discardStaged">放弃待并入结果</el-button>
      </div>
    </el-alert>

    <el-alert
      v-if="hasRevisionDraft"
      class="draft-banner"
      type="warning"
      show-icon
      :closable="false"
      :title="`基线已锁定，当前为修订稿 ${revision}`"
      description="锁定后的改动另开修订稿，不影响已锁定的演出基线。"
    />

    <div class="sync-section">
      <div class="section-head">
        <strong>本机队列（{{ pendingOps.length }}）</strong>
        <el-button v-if="failedCount" size="small" type="primary" plain @click="retry">重试失败项（{{ failedCount }}）</el-button>
      </div>
      <div v-if="pendingOps.length === 0" class="sync-empty">暂无待合并的离线操作</div>
      <div v-else class="op-list">
        <div v-for="op in pendingOps" :key="op.opId" class="op-item" :class="{ failed: op.status === 'failed' }">
          <div class="op-main">
            <el-tag size="small" :type="roleTagType(op.role)" effect="plain">{{ ROLE_LABELS[op.role] }}</el-tag>
            <strong>{{ op.cueId }}</strong>
            <span class="muted">{{ opSummary(op) }}</span>
          </div>
          <div class="op-meta">
            <span class="muted">{{ op.savedAt }}</span>
            <el-tag size="small" :type="op.status === 'failed' ? 'danger' : 'info'" effect="plain">
              {{ op.status === 'failed' ? `失败 · 第 ${op.attempts} 次` : '待合并' }}
            </el-tag>
            <el-button link type="danger" size="small" @click="store.removeOp(op.opId)">移除</el-button>
          </div>
          <p v-if="op.lastError" class="op-error">{{ op.lastError }}</p>
        </div>
      </div>
    </div>

    <div class="sync-section">
      <div class="section-head">
        <strong>待核差异（{{ pendingDiffs.length }}）</strong>
        <span class="muted">双方都改过的字段需确认取舍</span>
      </div>
      <div v-if="pendingDiffs.length === 0" class="sync-empty">没有待核差异</div>
      <div v-else class="diff-list">
        <div v-for="diff in pendingDiffs" :key="`${diff.field}-${diff.nodeIndex ?? ''}`" class="diff-item" :class="{ interlock: diff.interlockAffected }">
          <div class="diff-head">
            <strong>{{ findCueId(diff) }} · {{ diffLabel(diff) }}</strong>
            <el-tag v-if="diff.interlockAffected" size="small" type="danger" effect="dark">影响互锁</el-tag>
          </div>
          <div class="diff-values">
            <div class="diff-value">
              <span class="muted">舞台监督</span>
              <code>{{ diffValue(diff, 'local') }}</code>
              <el-button size="small" @click="resolve(diff, 'local')">采用</el-button>
            </div>
            <div class="diff-value">
              <span class="muted">前场导演</span>
              <code>{{ diffValue(diff, 'remote') }}</code>
              <el-button size="small" type="warning" @click="resolve(diff, 'remote')">采用</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="sync-section">
      <div class="section-head">
        <strong>合并日志</strong>
        <el-switch v-model="forceMergeFailure" active-text="模拟合并失败" inline-prompt />
      </div>
      <div v-if="mergeLog.length === 0" class="sync-empty">暂无合并记录</div>
      <div v-else class="log-list">
        <div v-for="(entry, index) in mergeLog" :key="index" class="log-item">
          <span class="muted">{{ entry.at }}</span>
          <span>{{ entry.count }} 项操作 · {{ entry.summary }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sync-panel {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.sync-roles,
.sync-network {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sync-label {
  color: #5d6b78;
  font-size: 12px;
}

.role-switch {
  display: flex;
  gap: 6px;
}

.role-btn {
  padding: 6px 14px;
  border: 1px solid #cdd8dc;
  border-radius: 6px;
  color: #44515b;
  background: #fff;
  cursor: pointer;
}

.role-btn.active {
  color: #fff;
}

.sync-network {
  padding: 10px 12px;
  border: 1px solid #e2e8ea;
  border-radius: 8px;
  background: #f7faf9;
}

.sync-network .el-button {
  margin-left: auto;
}

.halt-banner,
.draft-banner {
  margin: 0;
}

.halt-actions {
  margin-top: 8px;
}

.sync-section {
  display: grid;
  gap: 8px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sync-empty {
  padding: 14px;
  border: 1 dashed #d3dde0;
  border-radius: 6px;
  color: #8a959d;
  font-size: 12px;
  text-align: center;
}

.op-list,
.diff-list,
.log-list {
  display: grid;
  gap: 8px;
}

.op-item,
.diff-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e2e8ea;
  border-radius: 7px;
  background: #fff;
}

.op-item.failed {
  border-color: #e0b4ad;
  background: #fdf3f1;
}

.op-main,
.op-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.op-meta {
  justify-content: space-between;
}

.op-error {
  margin: 0;
  color: #b05a2b;
  font-size: 11px;
}

.diff-item.interlock {
  border-color: #d99a2b;
  background: #fdf8ec;
}

.diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.diff-values {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.diff-value {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid #e6ebed;
  border-radius: 6px;
  background: #f7f9f9;
}

.diff-value code {
  flex: 1;
  color: #183845;
  font-size: 12px;
  word-break: break-all;
}

.log-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #edf0f2;
  color: #5d6b78;
  font-size: 12px;
}
</style>
