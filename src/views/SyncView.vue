<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'
import { FIELD_LABELS, formatPoint, formatValue, type MergeField, type Role, type SyncOp } from '../sync/merge'

const store = useWorkshopStore()
const merging = computed(() => false)

const roles: Role[] = ['舞台监督', '前场导演']

const groupedOps = computed(() => {
  const groups = new Map<string, SyncOp[]>()
  for (const op of store.offlineOps) {
    const list = groups.get(op.cueId) ?? []
    list.push(op)
    groups.set(op.cueId, list)
  }
  return [...groups.entries()].map(([cueId, ops]) => ({
    cueId,
    cue: store.cues.find((item) => item.id === cueId),
    sm: ops.filter((op) => op.role === '舞台监督'),
    fd: ops.filter((op) => op.role === '前场导演'),
  }))
})

const cueMap = computed(() => new Map(store.cues.map((cue) => [cue.id, cue])))

function opText(op: SyncOp): string {
  if (op.kind === 'comment') return `留言：${op.commentContent}`
  if (op.kind === 'route-append' && op.point) return `追加路线节点 (${op.point.x}, ${op.point.y})`
  if (op.kind === 'route-node' && op.point) return `改节点 ${(op.index ?? 0) + 1} 坐标 → (${op.point.x}, ${op.point.y})`
  if (op.kind === 'field' && op.field) return `改${FIELD_LABELS[op.field]} → ${formatValue(op.field, op.value)}`
  return '未知操作'
}

async function goOfflineWithDemo() {
  if (store.isOffline) return
  store.toggleOffline() // 拍下断网前基线
  store.seedLocalOps() // 本机（舞台监督）队列
  store.seedTourChangeoverOps() // 前场导演端队列
  ElMessage.success('已进入断网：双端操作分别进入本机队列，等待网络恢复')
}

async function reconnectAndMerge() {
  if (!store.isOffline) return
  store.toggleOffline() // 恢复在线
  await store.runMerge()
}

async function retry() {
  await store.retryMerge()
}

function valuePair(field: MergeField, value: unknown) {
  if (field === 'route' && value && typeof value === 'object' && 'x' in value) return formatPoint(value as { x: number; y: number })
  return formatValue(field, value)
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">OFFLINE SYNC / 断网换场合并</p>
        <h1>双端断网保存 · 网络恢复合并</h1>
        <p class="muted">按提示编号合并舞台监督与前场导演的操作：单边改动直接并入，双方同改并列待核，留言与路线不重复追加。</p>
      </div>
      <div class="actions">
        <el-button @click="$router.push('/print')">前往打印中心</el-button>
      </div>
    </div>

    <!-- 互锁冻结横幅 -->
    <el-alert
      v-if="store.baselineHeld"
      class="hold-alert"
      type="error"
      show-icon
      :closable="false"
      title="演出基线已停住：存在影响互锁判断的待核差异"
      description="请先在下方逐项核对触发时间 / 入场点 / 路线节点。全部裁决前，清单编辑停用，打印中心保留旧版清单。"
    />

    <div class="sync-grid">
      <!-- 左：终端与队列 -->
      <section class="panel">
        <div class="panel-head">
          <h3>断网终端与本机队列</h3>
          <el-tag :type="store.isOffline ? 'warning' : 'success'" effect="plain">
            {{ store.isOffline ? '断网中' : '网络正常' }}
          </el-tag>
        </div>

        <div class="sync-body">
          <div class="role-row">
            <span>本机终端身份</span>
            <el-radio-group :model-value="store.activeRole" @update:model-value="store.setRole($event as Role)" size="small">
              <el-radio-button v-for="role in roles" :key="role" :value="role">{{ role }}</el-radio-button>
            </el-radio-group>
          </div>

          <div class="step-row">
            <el-button type="primary" plain :disabled="store.isOffline" @click="goOfflineWithDemo">
              1. 模拟巡演换场断网（自动填入双端操作）
            </el-button>
            <el-button type="primary" :disabled="!store.isOffline || store.offlineOps.length === 0" :loading="merging" @click="reconnectAndMerge">
              2. 网络恢复，按提示编号合并
            </el-button>
          </div>

          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="想验证失败重试？"
            class="fail-box"
          >
            <div class="fail-actions">
              <el-switch :model-value="store.failNextMerge" @update:model-value="store.toggleFailNextMerge" active-text="让下一次合并失败" />
              <el-button v-if="store.offlineOps.length && !store.isOffline" size="small" @click="retry">立即重试合并</el-button>
              <el-button v-if="store.offlineOps.length" size="small" text @click="store.clearQueue">清空队列</el-button>
            </div>
          </el-alert>

          <div class="queue-head">
            <strong>本机待合并队列（{{ store.offlineOps.length }}）</strong>
            <span class="muted">合并失败时保留，重试不重复追加</span>
          </div>

          <div v-if="groupedOps.length" class="queue-groups">
            <div v-for="group in groupedOps" :key="group.cueId" class="queue-group">
              <div class="queue-cue">
                <strong>{{ group.cueId }} · {{ group.cue?.title ?? '未知提示' }}</strong>
                <el-tag v-if="store.heldCueIds.has(group.cueId)" type="danger" size="small" effect="plain">互锁待核</el-tag>
              </div>
              <div class="side-cols">
                <div class="side">
                  <span class="side-label sm">舞台监督端 × {{ group.sm.length }}</span>
                  <p v-for="op in group.sm" :key="op.id" :class="{ errored: op.lastError }">{{ opText(op) }}</p>
                </div>
                <div class="side">
                  <span class="side-label fd">前场导演端 × {{ group.fd.length }}</span>
                  <p v-for="op in group.fd" :key="op.id" :class="{ errored: op.lastError }">{{ opText(op) }}</p>
                </div>
              </div>
            </div>
          </div>
          <el-empty v-else description="队列是空的：先模拟一次换场断网" :image-size="64" />
        </div>
      </section>

      <!-- 右：待核差异 -->
      <section class="panel">
        <div class="panel-head">
          <h3>待核差异（{{ store.pendingDiffs.length }}）</h3>
          <span class="muted">双方都改过且不一致</span>
        </div>
        <div class="diff-body">
          <div v-if="store.pendingDiffs.length" class="diff-list">
            <article
              v-for="{ cue, diff } in store.pendingDiffs"
              :key="diff.id"
              class="diff-card"
              :class="{ hold: cue.interlock }"
            >
              <header>
                <strong>{{ cue.id }} · {{ cue.title }}</strong>
                <el-tag :type="cue.interlock ? 'danger' : 'info'" size="small" effect="plain">
                  {{ cue.interlock ? '影响互锁' : '不影响互锁' }} · {{ FIELD_LABELS[diff.field] }}<template v-if="diff.index >= 0"> {{ diff.index + 1 }}</template>
                </el-tag>
              </header>
              <div class="diff-values">
                <button class="value sm" @click="store.resolvePendingDiff(cue.id, diff, '舞台监督')">
                  <span>舞台监督端</span>
                  <b>{{ diff.field ? valuePair(diff.field, diff.smValue) : '' }}</b>
                  <i>采用此值</i>
                </button>
                <button class="value fd" @click="store.resolvePendingDiff(cue.id, diff, '前场导演')">
                  <span>前场导演端</span>
                  <b>{{ diff.field ? valuePair(diff.field, diff.fdValue) : '' }}</b>
                  <i>采用此值</i>
                </button>
              </div>
              <p class="diff-note">
                基线当前保留原值：{{ diff.field === 'route' && diff.index >= 0 ? `节点 ${diff.index + 1}` : '' }}{{ diff.field !== 'route' && diff.field ? formatValue(diff.field, (cue as Record<string, unknown>)[diff.field]) : '' }}
              </p>
            </article>
          </div>
          <el-empty v-else description="暂无待核差异" :image-size="64" />
        </div>
      </section>
    </div>

    <!-- 合并日志 -->
    <section v-if="store.mergeLogs.length" class="panel log-panel">
      <div class="panel-head">
        <h3>本次合并记录</h3>
        <span class="muted">直接并入 / 待核差异 / 去重</span>
      </div>
      <ul class="log-list">
        <li v-for="(log, index) in store.mergeLogs" :key="index" :class="log.kind">
          <em>{{ cueMap.get(log.cueId)?.id ?? log.cueId }}</em>
          {{ log.text }}
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.hold-alert {
  margin-bottom: 14px;
}

.sync-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 14px;
  align-items: start;
}

.sync-body,
.diff-body {
  padding: 16px;
}

.role-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  color: #5d6b78;
  font-size: 13px;
}

.step-row {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.fail-box {
  margin-bottom: 16px;
}

.fail-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.queue-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}

.queue-groups {
  display: grid;
  gap: 12px;
}

.queue-group {
  border: 1px solid #e3e9ec;
  border-radius: 8px;
  overflow: hidden;
}

.queue-cue {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  background: #f4f8f8;
  font-size: 12px;
}

.side-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.side {
  padding: 10px 12px;
}

.side:first-child {
  border-right: 1px solid #edf0f2;
}

.side-label {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
}

.side-label.sm {
  color: #23605e;
}

.side-label.fd {
  color: #8a4d1f;
}

.side p {
  margin: 4px 0;
  padding: 5px 7px;
  border-radius: 5px;
  background: #f8fafa;
  color: #4c5964;
  font-size: 11px;
  line-height: 1.45;
}

.side p.errored {
  border: 1px solid #e6b4ad;
  background: #fdf1ef;
  color: #a84236;
}

.diff-list {
  display: grid;
  gap: 12px;
}

.diff-card {
  padding: 12px;
  border: 1px solid #e3e9ec;
  border-left: 3px solid #c6cfd5;
  border-radius: 8px;
}

.diff-card.hold {
  border-left-color: #cf4f3f;
  background: #fef6f4;
}

.diff-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12px;
}

.diff-values {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.value {
  display: grid;
  gap: 3px;
  padding: 9px;
  border: 1px solid #d9e1e4;
  border-radius: 7px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.value:hover {
  border-color: #2f8580;
  box-shadow: 0 0 0 2px rgb(47 133 128 / 12%);
}

.value span {
  color: #82909a;
  font-size: 10px;
}

.value b {
  color: #213d46;
  font-size: 13px;
}

.value i {
  color: #2f8580;
  font-size: 10px;
  font-style: normal;
}

.diff-note {
  margin: 8px 0 0;
  color: #8a959d;
  font-size: 11px;
}

.log-panel {
  margin-top: 14px;
}

.log-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 12px 16px;
  list-style: none;
  font-size: 12px;
  color: #52606b;
}

.log-list em {
  margin-right: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  color: #1d5c5a;
  background: #e6f2f1;
  font-style: normal;
  font-weight: 700;
}

.log-list li.diff {
  color: #a84236;
}

.log-list li.diff em {
  color: #a84236;
  background: #fbe7e3;
}

.log-list li.dup em {
  color: #8a651c;
  background: #f7efd9;
}

@media (max-width: 1040px) {
  .sync-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .side-cols,
  .diff-values {
    grid-template-columns: 1fr;
  }

  .side:first-child {
    border-right: 0;
    border-bottom: 1px solid #edf0f2;
  }
}
</style>
