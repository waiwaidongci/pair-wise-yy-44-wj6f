import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import {
  consolidateDraft,
  diffCue,
  isHalted,
  pendingDiffCount,
  resolveDiff as resolveMergeDiff,
  threeWayMerge,
  type CueMergeResult,
  type OfflineOp,
  type Role,
} from '../lib/merge'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number; clientId?: string; pair?: Point }

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
  route: Point[]
  note: string
  status: '草稿' | '待确认' | '已确认'
  comments: Comment[]
  interlocked?: boolean
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
    interlocked: true,
    comments: [],
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
  },
]

const STORAGE_KEY = 'stage-scheduler-draft-v1'

type PersistedState = {
  cues?: Cue[]
  revision?: number
  offlineQueue?: OfflineOp[]
  appliedClientIds?: Record<string, string[]>
  revisionDraft?: Cue[] | null
  lastGoodBaseline?: Cue[]
  halted?: boolean
  mergeResults?: CueMergeResult[]
  stagedCues?: Cue[] | null
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : {}
  } catch {
    return {}
  }
}

const SCALAR_FIELDS = [
  'act',
  'scene',
  'time',
  'title',
  'department',
  'owner',
  'duration',
  'entry',
  'exit',
  'note',
  'status',
] as const

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useWorkshopStore = defineStore('workshop', () => {
  const restored = loadPersisted()
  const cues = ref<Cue[]>(restored.cues?.length ? restored.cues : clone(seedCues))
  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const locked = ref(false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  // --- offline collaboration state ---
  const activeRole = ref<Role>('stage-manager')
  const offlineDrafts = ref<Record<Role, Cue[] | null>>({ 'stage-manager': null, 'foh-director': null })
  const offlineQueue = ref<OfflineOp[]>(restored.offlineQueue ?? [])
  const appliedClientIds = ref<Record<string, string[]>>(restored.appliedClientIds ?? {})
  const revisionDraft = ref<Cue[] | null>(restored.revisionDraft ?? null)
  const lastGoodBaseline = ref<Cue[]>(restored.lastGoodBaseline ?? clone(seedCues))
  const halted = ref(restored.halted ?? false)
  const mergeResults = ref<CueMergeResult[]>(restored.mergeResults ?? [])
  const stagedCues = ref<Cue[] | null>(restored.stagedCues ?? null)
  const forceMergeFailure = ref(false)
  const mergeLog = ref<Array<{ at: string; count: number; summary: string }>>([])

  const displayCues = computed(() => {
    if (isOffline.value) return offlineDrafts.value[activeRole.value] ?? cues.value
    return revisionDraft.value ?? cues.value
  })
  const selectedCue = computed(() => displayCues.value.find((cue) => cue.id === selectedId.value) ?? displayCues.value[0])
  const filteredCues = computed(() =>
    displayCues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  const conflicts = computed(() =>
    displayCues.value.filter((cue, index) =>
      displayCues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )

  const printCues = computed(() => {
    if (halted.value) return lastGoodBaseline.value
    return revisionDraft.value ?? cues.value
  })
  const pendingOps = computed(() => offlineQueue.value.filter((op) => op.status !== 'merged'))
  const pendingDiffs = computed(() => mergeResults.value.flatMap((result) => result.diffs).filter((diff) => diff.status === 'pending'))
  const interlockDiffs = computed(() => pendingDiffs.value.filter((diff) => diff.interlockAffected))
  const canApply = computed(() => mergeResults.value.length > 0 && !halted.value && pendingDiffs.value.length === 0)
  const hasRevisionDraft = computed(() => revisionDraft.value !== null)

  watch(
    [cues, rev, isOffline, offlineQueue, appliedClientIds, revisionDraft, lastGoodBaseline, halted, mergeResults, stagedCues],
    () => {
      const payload: PersistedState = {
        cues: cues.value,
        revision: rev.value,
        offlineQueue: offlineQueue.value,
        appliedClientIds: appliedClientIds.value,
        revisionDraft: revisionDraft.value,
        lastGoodBaseline: lastGoodBaseline.value,
        halted: halted.value,
        mergeResults: mergeResults.value,
        stagedCues: stagedCues.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    { deep: true },
  )

  function snapshot() {
    undoStack.value.push(clone(cues.value))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  function ensureRevisionDraft() {
    if (!revisionDraft.value) {
      revisionDraft.value = clone(cues.value)
    }
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (isOffline.value) {
      const draft = offlineDrafts.value[activeRole.value]
      if (!draft) return
      const index = draft.findIndex((cue) => cue.id === selectedId.value)
      if (index < 0) return
      draft[index] = { ...draft[index], ...patch }
      recordEdit(selectedId.value)
      return
    }
    if (locked.value) {
      ensureRevisionDraft()
      const index = revisionDraft.value!.findIndex((cue) => cue.id === selectedId.value)
      if (index < 0) return
      revisionDraft.value![index] = { ...revisionDraft.value![index], ...patch }
      rev.value += 1
      return
    }
    snapshot()
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return
    cues.value[index] = { ...cues.value[index], ...patch }
    if (addRevision) rev.value += 1
  }

  function addWaypoint(point: { x: number; y: number }) {
    if (isOffline.value) {
      const draft = offlineDrafts.value[activeRole.value]
      if (!draft) return
      const cue = draft.find((item) => item.id === selectedId.value)
      if (!cue) return
      cue.route.push({ x: point.x, y: point.y, clientId: `route-${crypto.randomUUID()}` })
      recordEdit(selectedId.value)
      return
    }
    if (locked.value) {
      ensureRevisionDraft()
      const cue = revisionDraft.value!.find((item) => item.id === selectedId.value)
      if (!cue) return
      cue.route.push({ x: point.x, y: point.y })
      rev.value += 1
      return
    }
    const cue = selectedCue.value
    if (!cue) return
    updateCue({ route: [...cue.route, point] })
  }

  function updateRouteNode(nodeIndex: number, point: { x: number; y: number }) {
    if (isOffline.value) {
      const draft = offlineDrafts.value[activeRole.value]
      if (!draft) return
      const cue = draft.find((item) => item.id === selectedId.value)
      if (!cue || !cue.route[nodeIndex]) return
      cue.route[nodeIndex] = { ...cue.route[nodeIndex], x: point.x, y: point.y }
      recordEdit(selectedId.value)
      return
    }
    if (locked.value) {
      ensureRevisionDraft()
      const cue = revisionDraft.value!.find((item) => item.id === selectedId.value)
      if (!cue || !cue.route[nodeIndex]) return
      cue.route[nodeIndex] = { ...cue.route[nodeIndex], x: point.x, y: point.y }
      rev.value += 1
      return
    }
    const cue = selectedCue.value
    if (!cue || !cue.route[nodeIndex]) return
    snapshot()
    const route = [...cue.route]
    route[nodeIndex] = { ...route[nodeIndex], x: point.x, y: point.y }
    updateCue({ route })
  }

  function addCue() {
    if (isOffline.value) {
      const draft = offlineDrafts.value[activeRole.value]
      if (!draft) return
      const next = draft.length + 1
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
        route: [{ x: 10, y: 50, clientId: `route-${crypto.randomUUID()}` }, { x: 90, y: 50, clientId: `route-${crypto.randomUUID()}` }],
        note: '',
        status: '草稿',
        comments: [],
      }
      draft.push(cue)
      selectedId.value = cue.id
      recordEdit(cue.id)
      return
    }
    if (locked.value) {
      ensureRevisionDraft()
      const next = revisionDraft.value!.length + 1
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
      revisionDraft.value!.push(cue)
      selectedId.value = cue.id
      rev.value += 1
      return
    }
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
    if (isOffline.value) return
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(clone(cues.value))
    cues.value = previous
    rev.value += 1
  }

  function redo() {
    if (isOffline.value) return
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(clone(cues.value))
    cues.value = next
    rev.value += 1
  }

  function addComment(content: string, author = '当前用户') {
    if (isOffline.value) {
      const draft = offlineDrafts.value[activeRole.value]
      if (!draft) return
      const cue = draft.find((item) => item.id === selectedId.value)
      if (!cue) return
      cue.comments.push({
        id: `comment-${crypto.randomUUID()}`,
        author,
        content,
        createdAt: new Date().toLocaleString('zh-CN'),
        resolved: false,
      })
      recordEdit(selectedId.value)
      return
    }
    if (locked.value) {
      ensureRevisionDraft()
      const cue = revisionDraft.value!.find((item) => item.id === selectedId.value)
      if (!cue) return
      cue.comments.push({
        id: `comment-${crypto.randomUUID()}`,
        author,
        content,
        createdAt: new Date().toLocaleString('zh-CN'),
        resolved: false,
      })
      rev.value += 1
      return
    }
    const cue = selectedCue.value
    if (!cue) return
    snapshot()
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
    locked.value = true
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    rev.value += 1
  }

  function unlockBaseline() {
    locked.value = false
    revisionDraft.value = null
    rev.value += 1
  }

  // --- offline / merge orchestration ---

  function setRole(role: Role) {
    activeRole.value = role
  }

  function goOffline() {
    if (!offlineDrafts.value['stage-manager'] || !offlineDrafts.value['foh-director']) {
      offlineDrafts.value = {
        'stage-manager': clone(cues.value),
        'foh-director': clone(cues.value),
      }
    }
    isOffline.value = true
  }

  function clearDrafts() {
    offlineDrafts.value = { 'stage-manager': null, 'foh-director': null }
  }

  function goOnline() {
    isOffline.value = false
    clearDrafts()
    if (pendingOps.value.length > 0) {
      mergeNow()
    }
  }

  function toggleOffline() {
    if (isOffline.value) goOnline()
    else goOffline()
  }

  function recordEdit(cueId: string) {
    const draft = offlineDrafts.value[activeRole.value]
    if (!draft) return
    const base = cues.value.find((cue) => cue.id === cueId)
    const draftCue = draft.find((cue) => cue.id === cueId)
    if (!draftCue) return

    let fields: OfflineOp['fields'] = {}
    let routeNodes: OfflineOp['routeNodes'] = {}
    let routeAppends: OfflineOp['routeAppends'] = []
    let commentAppends: OfflineOp['commentAppends'] = []

    if (base) {
      const diff = diffCue(base, draftCue)
      fields = diff.fields
      routeNodes = diff.routeNodes
      routeAppends = diff.routeAppends
      commentAppends = diff.commentAppends
    } else {
      // Cue created offline: everything is an append relative to the baseline.
      for (const field of SCALAR_FIELDS) {
        const value = (draftCue as Record<string, unknown>)[field]
        if (value !== undefined) fields[field] = { from: null, to: clone(value) }
      }
      routeAppends = draftCue.route
        .filter((point) => point.clientId)
        .map((point) => ({ clientId: point.clientId as string, point: { x: point.x, y: point.y } }))
      commentAppends = draftCue.comments.map((comment) => ({ clientId: comment.id, comment: clone(comment) }))
    }

    const hasChanges =
      Object.keys(fields).length > 0 ||
      Object.keys(routeNodes).length > 0 ||
      routeAppends.length > 0 ||
      commentAppends.length > 0

    const key = `${activeRole.value}:${cueId}`
    const index = offlineQueue.value.findIndex((op) => `${op.role}:${op.cueId}` === key && op.status !== 'merged')
    if (!hasChanges) {
      if (index >= 0) offlineQueue.value.splice(index, 1)
      return
    }
    const existing = index >= 0 ? offlineQueue.value[index] : null
    const op: OfflineOp = {
      opId: existing?.opId ?? `op-${activeRole.value}-${cueId}-${Date.now()}`,
      cueId,
      role: activeRole.value,
      savedAt: new Date().toISOString(),
      baseRevision: rev.value,
      fields,
      routeNodes,
      routeAppends,
      commentAppends,
      status: 'pending',
      attempts: existing?.attempts ?? 0,
    }
    if (index >= 0) offlineQueue.value[index] = op
    else offlineQueue.value.push(op)
  }

  function collectAppliedIds(results: CueMergeResult[]) {
    for (const result of results) {
      const ids: string[] = []
      result.merged.route.forEach((point) => {
        if (point.clientId) ids.push(point.clientId as string)
      })
      result.merged.comments.forEach((comment) => ids.push(comment.id))
      appliedClientIds.value[result.cueId] = [
        ...new Set([...(appliedClientIds.value[result.cueId] ?? []), ...ids]),
      ]
    }
  }

  function applyCues(next: Cue[]) {
    if (locked.value) {
      revisionDraft.value = clone(next)
    } else {
      cues.value = clone(next)
      lastGoodBaseline.value = clone(next)
    }
    rev.value += 1
  }

  function mergeNow() {
    const pending = offlineQueue.value.filter((op) => op.status !== 'merged')
    if (pending.length === 0) {
      ElMessage.info('没有待合并的离线操作')
      return
    }
    if (forceMergeFailure.value) {
      pending.forEach((op) => {
        op.status = 'failed'
        op.attempts += 1
        op.lastError = '模拟合并失败：服务端未确认，本机队列保留待重试'
      })
      ElMessage.error('合并失败：本机队列已保留，可在网络恢复后重试')
      return
    }

    const localOps = offlineQueue.value.filter((op) => op.role === 'stage-manager' && op.status !== 'merged')
    const remoteOps = offlineQueue.value.filter((op) => op.role === 'foh-director' && op.status !== 'merged')
    const applied = new Set<string>()
    Object.values(appliedClientIds.value).forEach((ids) => ids.forEach((id) => applied.add(id)))

    const result = threeWayMerge(cues.value, localOps, remoteOps, applied)
    pending.forEach((op) => {
      op.status = 'merged'
      op.attempts += 1
    })
    collectAppliedIds(result.results)
    mergeResults.value = result.results
    mergeLog.value.unshift({
      at: new Date().toLocaleString('zh-CN'),
      count: pending.length,
      summary: result.halted ? '合并完成但互锁差异令基线停住' : '合并完成并并入基线',
    })

    if (result.halted) {
      halted.value = true
      stagedCues.value = result.cues
      ElMessage.warning('差异影响互锁判断，演出基线已停住，打印中心保留旧版清单')
    } else {
      applyCues(result.cues)
      stagedCues.value = null
      ElMessage.success('离线操作已按提示编号合并并入基线')
    }
  }

  function retryMerge() {
    mergeNow()
  }

  function resolveDiff(cueId: string, field: string, nodeIndex: number | undefined, choice: 'local' | 'remote') {
    const wasHalted = halted.value
    mergeResults.value = resolveMergeDiff(mergeResults.value, cueId, field, nodeIndex, choice)

    if (wasHalted) {
      stagedCues.value = mergeResults.value.map((result) => result.merged)
      if (isHalted(mergeResults.value)) return
      // Halt cleared: release the frozen baseline and apply all staged changes.
      halted.value = false
      applyCues(stagedCues.value)
      mergeResults.value = []
      stagedCues.value = null
      ElMessage.success('互锁差异已处理，基线恢复并并入')
      return
    }

    // Not halted: the merged cues are already in the baseline; apply the resolved cue.
    const result = mergeResults.value.find((item) => item.cueId === cueId)
    if (result) {
      if (locked.value) {
        ensureRevisionDraft()
        const index = revisionDraft.value!.findIndex((cue) => cue.id === cueId)
        if (index >= 0) revisionDraft.value![index] = clone(result.merged)
      } else {
        const index = cues.value.findIndex((cue) => cue.id === cueId)
        if (index >= 0) cues.value[index] = clone(result.merged)
        lastGoodBaseline.value = clone(cues.value)
      }
      rev.value += 1
    }
    if (pendingDiffs.value.length === 0) {
      mergeResults.value = []
      stagedCues.value = null
      ElMessage.success('差异已处理完毕，基线已更新')
    }
  }

  function discardStaged() {
    mergeResults.value = []
    stagedCues.value = null
    halted.value = false
    ElMessage.info('已放弃待并入的合并结果，基线保持旧版')
  }

  function removeOp(opId: string) {
    const index = offlineQueue.value.findIndex((op) => op.opId === opId)
    if (index >= 0) offlineQueue.value.splice(index, 1)
  }

  function cueDiffs(cueId: string) {
    return mergeResults.value
      .filter((result) => result.cueId === cueId)
      .flatMap((result) => result.diffs)
      .filter((diff) => diff.status === 'pending')
  }

  return {
    cues,
    selectedId,
    selectedCue,
    filteredCues,
    conflicts,
    printCues,
    displayCues,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    updateCue,
    addWaypoint,
    updateRouteNode,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    lockBaseline,
    unlockBaseline,
    // offline / merge
    activeRole,
    offlineDrafts,
    offlineQueue,
    appliedClientIds,
    revisionDraft,
    lastGoodBaseline,
    halted,
    mergeResults,
    stagedCues,
    forceMergeFailure,
    mergeLog,
    pendingOps,
    pendingDiffs,
    interlockDiffs,
    canApply,
    hasRevisionDraft,
    setRole,
    goOffline,
    goOnline,
    toggleOffline,
    recordEdit,
    mergeNow,
    retryMerge,
    resolveDiff,
    discardStaged,
    removeOp,
    cueDiffs,
  }
})
