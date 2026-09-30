import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import {
  hasBlockingDiff,
  mergeCues,
  resolveDiff,
  type FieldDiff,
  type MergeLogEntry,
  type Role,
  type SyncOp,
} from '../sync/merge'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number }

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
}

export type Cue = {
  id: string
  act: string
  scene: string
  time: string
  title: string
  department: Department
  owner: string
  duration: number
  entry: Point
  exit: Point
  route: Array<Point & { altX?: number; altY?: number; altRole?: Role }>
  note: string
  status: '草稿' | '待确认' | '已确认'
  comments: Comment[]
  /** 与机械/灯光等动作互锁：未决坐标或时间差异会冻结基线。 */
  interlock?: boolean
  /** 双端都改过且不一致、并列待核的差异。 */
  pendingDiffs?: FieldDiff[]
}

export const seedProject = {
  name: '潮汐来信',
  venue: '上海大剧院 · 大剧场',
  rehearsalDate: '2026-10-08',
  company: '远岸剧团',
}

export const seedMovers = [
  { id: 'M-01', alias: '林默', role: '父亲', group: '主要演员', color: '#d96b45' },
  { id: 'M-02', alias: '周予', role: '女儿', group: '主要演员', color: '#2f8d88' },
  { id: 'M-03', alias: '顾川', role: '灯塔守望者', group: '主要演员', color: '#4f6fb0' },
  { id: 'M-04', alias: '群演甲组', role: '旅客', group: '群演', color: '#ba8c2f' },
  { id: 'M-05', alias: '群演乙组', role: '码头工人', group: '群演', color: '#735ca8' },
]

export const seedCues: Cue[] = [
  {
    id: 'C-01',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:04:20',
    title: '林默从左侧门入场',
    department: '舞台',
    owner: '林默 / 周予',
    duration: 95,
    entry: { x: 10, y: 70 },
    exit: { x: 64, y: 38 },
    route: [{ x: 10, y: 70 }, { x: 35, y: 60 }, { x: 64, y: 38 }],
    note: '灯位切换后 2 秒入场，停在码头箱前。',
    status: '已确认',
    comments: [
      { id: 'c1', author: '王灯控', content: '面光需要延长 4 秒，保证转身动作可见。', createdAt: '2026-09-27 14:20', resolved: false },
    ],
  },
  {
    id: 'C-02',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:06:10',
    title: '信件道具交接',
    department: '道具',
    owner: '周予 / 道具组',
    duration: 40,
    entry: { x: 28, y: 30 },
    exit: { x: 55, y: 47 },
    route: [{ x: 28, y: 30 }, { x: 44, y: 40 }, { x: 55, y: 47 }],
    note: '使用 B 版信封，背台侧完成交接。',
    status: '待确认',
    comments: [],
  },
  {
    id: 'C-03',
    act: '第二幕',
    scene: '风暴',
    time: '00:21:35',
    title: '升降台上升 / 码头位移',
    department: '舞台',
    owner: '舞台机械',
    duration: 120,
    entry: { x: 72, y: 82 },
    exit: { x: 42, y: 50 },
    route: [{ x: 72, y: 82 }, { x: 60, y: 70 }, { x: 42, y: 50 }],
    note: '先确认演员离开危险半径，再启动升降台。',
    status: '草稿',
    comments: [],
    interlock: true,
  },
  {
    id: 'C-04',
    act: '第二幕',
    scene: '风暴',
    time: '00:23:05',
    title: '爆闪与低频重音',
    department: '灯光',
    owner: '王灯控 / 声场',
    duration: 18,
    entry: { x: 50, y: 12 },
    exit: { x: 50, y: 12 },
    route: [{ x: 50, y: 12 }],
    note: '与机械动作互锁，机械未到位禁止触发。',
    status: '待确认',
    comments: [],
    interlock: true,
  },
  {
    id: 'C-05',
    act: '第三幕',
    scene: '守望',
    time: '00:37:42',
    title: '三人灯塔调度',
    department: '舞台',
    owner: '主要演员组',
    duration: 70,
    entry: { x: 18, y: 82 },
    exit: { x: 82, y: 18 },
    route: [{ x: 18, y: 82 }, { x: 45, y: 66 }, { x: 68, y: 35 }, { x: 82, y: 18 }],
    note: '群演保持第二条对角线，不遮挡主视线。',
    status: '草稿',
    comments: [],
  },
  {
    id: 'C-06',
    act: '第三幕',
    scene: '守望',
    time: '00:39:10',
    title: '救生艇推入',
    department: '道具',
    owner: '道具组 / 群演乙组',
    duration: 50,
    entry: { x: 88, y: 64 },
    exit: { x: 70, y: 44 },
    route: [{ x: 88, y: 64 }, { x: 80, y: 54 }, { x: 70, y: 44 }],
    note: '与演员横穿路线冲突，需调整优先权。',
    status: '待确认',
    comments: [],
    interlock: true,
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v2'

type Persisted = {
  cues?: Cue[]
  revision?: number
  locked?: boolean
  baselineCues?: Cue[]
  baselineRevision?: string
  offlineOps?: SyncOp[]
  mergeBase?: Cue[]
  mergeLogs?: MergeLogEntry[]
  held?: boolean
  activeRole?: Role
  failNextMerge?: boolean
}

export const useWorkshopStore = defineStore('workshop', () => {
  const saved = localStorage.getItem(STORAGE_KEY)
  const legacy = localStorage.getItem('stage-scheduler-draft-v1')
  const restored: Persisted = saved
    ? (JSON.parse(saved) as Persisted)
    : legacy
      ? (JSON.parse(legacy) as Persisted)
      : {}
  const cues = ref<Cue[]>(restored.cues?.length ? restored.cues : structuredClone(seedCues))
  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(restored.locked ?? false)
  /** 锁定基线时的清单快照：打印中心在锁定期间始终输出这份旧版。 */
  const baselineCues = ref<Cue[]>(restored.baselineCues ?? [])
  const baselineRevision = ref(restored.baselineRevision ?? '')
  /** 锁定后另开的修订稿（与基线分离，屏幕上继续可编辑）。 */
  const draftOpen = computed(() => locked.value)
  const activeRole = ref<Role>(restored.activeRole ?? '舞台监督')
  const offlineOps = ref<SyncOp[]>(restored.offlineOps ?? [])
  const mergeBase = ref<Cue[]>(restored.mergeBase ?? [])
  const mergeLogs = ref<MergeLogEntry[]>(restored.mergeLogs ?? [])
  /** 待核差异命中互锁判断时，演出基线停住。 */
  const baselineHeld = ref(restored.held ?? false)
  const failNextMerge = ref(restored.failNextMerge ?? false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  const conflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )
  const pendingDiffs = computed(() =>
    cues.value.flatMap((cue) =>
      (cue.pendingDiffs ?? []).filter((diff) => !diff.resolved).map((diff) => ({ cue, diff })),
    ),
  )
  const heldCueIds = computed(() =>
    new Set(cues.value.filter((cue) => cue.interlock && hasBlockingDiff(cue)).map((cue) => cue.id)),
  )
  /** 打印中心读取的清单：基线锁定时保留旧版，否则用当前稿。 */
  const printCues = computed(() => (locked.value && baselineCues.value.length ? baselineCues.value : cues.value))
  const printRevision = computed(() => (locked.value && baselineRevision.value ? baselineRevision.value : revision.value))

  watch(
    [cues, rev, isOffline, locked, baselineCues, offlineOps, mergeBase, mergeLogs, baselineHeld, activeRole, failNextMerge],
    () => {
      const payload: Persisted = {
        cues: cues.value,
        revision: rev.value,
        locked: locked.value,
        baselineCues: baselineCues.value,
        baselineRevision: baselineRevision.value,
        offlineOps: offlineOps.value,
        mergeBase: mergeBase.value,
        mergeLogs: mergeLogs.value,
        held: baselineHeld.value,
        activeRole: activeRole.value,
        failNextMerge: failNextMerge.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  function snapshot() {
    undoStack.value.push(structuredClone(cues.value))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  /** 基线停住期间（互锁待核差异）禁止再改动，先核对差异。 */
  function assertNotHeld(): boolean {
    if (baselineHeld.value) {
      ElMessage.warning('基线已停住：请先核对影响互锁判断的差异')
      return false
    }
    return true
  }

  function enqueueOp(partial: Omit<SyncOp, 'id' | 'role' | 'createdAt'>) {
    offlineOps.value.push({
      ...partial,
      id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: activeRole.value,
      createdAt: Date.now(),
    })
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (!assertNotHeld()) return
    snapshot()
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return

    // 断网期间把字段改动记入本机队列，供网络恢复后按编号合并
    if (isOffline.value) {
      for (const [field, value] of Object.entries(patch)) {
        if (field === 'comments' || field === 'route' || field === 'pendingDiffs') continue
        enqueueOp({
          cueId: selectedId.value,
          kind: 'field',
          field: field as SyncOp['field'],
          value: structuredClone(value),
        })
      }
    }

    cues.value[index] = { ...cues.value[index], ...patch }
    if (addRevision) rev.value += 1
  }

  function addWaypoint(point: { x: number; y: number }) {
    const cue = selectedCue.value
    if (!cue || !assertNotHeld()) return
    snapshot()
    if (isOffline.value) enqueueOp({ cueId: cue.id, kind: 'route-append', point })
    cue.route.push({ x: point.x, y: point.y })
    rev.value += 1
  }

  function addCue() {
    if (!assertNotHeld()) return
    snapshot()
    const next = cues.value.length + 1
    const cue: Cue = {
      id: `C-${String(next).padStart(2, '0')}`,
      act: '第一幕',
      scene: '新场景',
      time: '00:00:00',
      title: '新执行提示',
      department: '舞台',
      owner: '待指派',
      duration: 30,
      entry: { x: 10, y: 50 },
      exit: { x: 90, y: 50 },
      route: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
      note: '',
      status: '草稿',
      comments: [],
    }
    cues.value.push(cue)
    selectedId.value = cue.id
    rev.value += 1
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(structuredClone(cues.value))
    cues.value = previous
    rev.value += 1
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(structuredClone(cues.value))
    cues.value = next
    rev.value += 1
  }

  function addComment(content: string, author = '当前用户') {
    const cue = selectedCue.value
    if (!cue || !assertNotHeld()) return
    snapshot()
    if (isOffline.value) enqueueOp({ cueId: cue.id, kind: 'comment', commentAuthor: author, commentContent: content })
    cue.comments.push({
      id: `local-${Date.now()}`,
      author,
      content,
      createdAt: new Date().toLocaleString('zh-CN'),
      resolved: false,
    })
    rev.value += 1
  }

  function toggleComment(commentId: string) {
    const comment = selectedCue.value?.comments.find((item) => item.id === commentId)
    if (comment) comment.resolved = !comment.resolved
  }

  function lockBaseline() {
    if (locked.value) return
    locked.value = true
    baselineCues.value = structuredClone(cues.value)
    baselineRevision.value = revision.value
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    rev.value += 1
  }

  function unlockBaseline() {
    locked.value = false
    baselineCues.value = []
    baselineRevision.value = ''
    rev.value += 1
  }

  function toggleOffline() {
    if (!isOffline.value) {
      // 进入断网：拍下断网前的共同基线，双端操作都从它合并
      mergeBase.value = structuredClone(cues.value)
      offlineOps.value = []
      mergeLogs.value = []
      isOffline.value = true
    } else {
      isOffline.value = false
    }
  }

  function setRole(role: Role) {
    activeRole.value = role
  }

  /**
   * 一键模拟换场：前场导演端在同一断网窗口保存另一终端的操作。
   * 含双方同改、单端修改、重复留言 / 节点、互锁与非互锁四类场景。
   */
  function seedTourChangeoverOps() {
    const now = Date.now()
    const remote: SyncOp[] = [
      // C-03（互锁）：双方都改触发时间 + 同一中间节点坐标不同 → 冻结基线
      { id: 'fd-1', role: '前场导演', cueId: 'C-03', kind: 'field', field: 'time', value: '00:21:40', createdAt: now + 1 },
      { id: 'fd-2', role: '前场导演', cueId: 'C-03', kind: 'route-node', index: 1, point: { x: 56, y: 64 }, createdAt: now + 2 },
      // C-01（非互锁）：双方都改执行说明 → 待核差异但不冻结
      { id: 'fd-3', role: '前场导演', cueId: 'C-01', kind: 'field', field: 'note', value: '前场导演：面光延长后入场，码头箱定位点右移 1 米。', createdAt: now + 3 },
      // C-02：仅前场导演改责任角色 → 直接并入
      { id: 'fd-4', role: '前场导演', cueId: 'C-02', kind: 'field', field: 'owner', value: '周予 / 道具组 / 前场代班', createdAt: now + 4 },
      // 与舞台监督端重复的留言 → 去重
      { id: 'fd-5', role: '前场导演', cueId: 'C-03', kind: 'comment', commentAuthor: '舞台监督 · 郑屿', commentContent: '机械启动前必须确认危险半径清空。', createdAt: now + 5 },
      // 与舞台监督端重复追加的节点 → 去重
      { id: 'fd-6', role: '前场导演', cueId: 'C-01', kind: 'route-append', point: { x: 50, y: 49 }, createdAt: now + 6 },
    ]
    offlineOps.value.push(...remote)
  }

  function seedLocalOps() {
    const now = Date.now()
    const local: SyncOp[] = [
      { id: 'sm-1', role: '舞台监督', cueId: 'C-03', kind: 'field', field: 'time', value: '00:21:44', createdAt: now - 6 },
      { id: 'sm-2', role: '舞台监督', cueId: 'C-03', kind: 'route-node', index: 1, point: { x: 62, y: 68 }, createdAt: now - 5 },
      { id: 'sm-3', role: '舞台监督', cueId: 'C-01', kind: 'field', field: 'note', value: '舞台监督：灯位切换后 2 秒入场，停在码头箱前并报位。', createdAt: now - 4 },
      { id: 'sm-4', role: '舞台监督', cueId: 'C-05', kind: 'field', field: 'duration', value: 78, createdAt: now - 3 },
      { id: 'sm-5', role: '舞台监督', cueId: 'C-03', kind: 'comment', commentAuthor: '舞台监督 · 郑屿', commentContent: '机械启动前必须确认危险半径清空。', createdAt: now - 2 },
      { id: 'sm-6', role: '舞台监督', cueId: 'C-01', kind: 'route-append', point: { x: 50, y: 49 }, createdAt: now - 1 },
    ]
    offlineOps.value.unshift(...local)
  }

  function clearQueue() {
    offlineOps.value = []
    mergeLogs.value = []
  }

  /** 网络恢复后按提示编号合并双端操作。合并失败时本机队列保留重试。 */
  async function runMerge(shouldFail = failNextMerge.value): Promise<{ ok: boolean; held: boolean }> {
    if (isOffline.value) {
      ElMessage.warning('仍处于断网状态，无法合并')
      return { ok: false, held: baselineHeld.value }
    }
    if (!mergeBase.value.length) {
      ElMessage.warning('缺少断网前基线，无法合并')
      return { ok: false, held: baselineHeld.value }
    }
    if (!offlineOps.value.length) {
      ElMessage.info('本机队列中没有待合并操作')
      return { ok: false, held: baselineHeld.value }
    }

    // 模拟上传合并：失败时不触碰清单，队列原样留着重试
    await new Promise((resolve) => setTimeout(resolve, 450))
    if (shouldFail) {
      failNextMerge.value = false
      offlineOps.value = offlineOps.value.map((op) =>
        op.lastError ? op : { ...op, lastError: '合并服务暂不可用，已保留待重试' },
      )
      ElMessage.error('合并失败：本机队列已保留，可稍后重试')
      return { ok: false, held: baselineHeld.value }
    }

    const report = mergeCues(mergeBase.value, offlineOps.value)
    cues.value = report.cues
    mergeLogs.value = report.logs
    offlineOps.value = [] // 成功后清空；留言 / 节点在合并函数中已去重，不会重复追加
    mergeBase.value = []
    rev.value += 1

    if (report.holdCueIds.length) {
      baselineHeld.value = true
      ElMessage.warning(`差异影响 ${report.holdCueIds.join('、')} 的互锁判断，演出基线已停住`)
    } else {
      ElMessage.success(`合并完成：直接并入与留言已生效，去重 ${report.duplicateSkipped} 项`)
    }
    return { ok: true, held: baselineHeld.value }
  }

  async function retryMerge() {
    return runMerge(false)
  }

  function toggleFailNextMerge() {
    failNextMerge.value = !failNextMerge.value
  }

  /** 人工裁决待核差异。影响互锁的差异全部裁决后，基线解除冻结。 */
  function resolvePendingDiff(cueId: string, diff: FieldDiff, side: Role) {
    const stillHeld = resolveDiff(cues.value, cueId, diff, side)
    baselineHeld.value = stillHeld
    rev.value += 1
    if (!stillHeld) ElMessage.success('互锁差异已全部核对，演出基线恢复')
  }

  return {
    cues,
    selectedId,
    selectedCue,
    filteredCues,
    conflicts,
    pendingDiffs,
    heldCueIds,
    printCues,
    printRevision,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    draftOpen,
    baselineHeld,
    activeRole,
    offlineOps,
    mergeLogs,
    failNextMerge,
    setRole,
    seedTourChangeoverOps,
    seedLocalOps,
    clearQueue,
    runMerge,
    retryMerge,
    toggleFailNextMerge,
    resolvePendingDiff,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    updateCue,
    addWaypoint,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    lockBaseline,
    unlockBaseline,
    toggleOffline,
  }
})
