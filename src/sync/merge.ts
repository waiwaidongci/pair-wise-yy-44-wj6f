import type { Cue, Point } from '../stores/workshop'

/** 断网期间同时保存同一提示的两个终端角色。 */
export type Role = '舞台监督' | '前场导演'

/**
 * 路线节点。合并后若两端都改过同一节点且坐标不一致，
 * 主坐标与 alt* 并列保留，进入待核差异。
 */
export type RouteNode = Point & {
  altX?: number
  altY?: number
  altRole?: Role
}

export type MergeField =
  | 'time'
  | 'title'
  | 'scene'
  | 'department'
  | 'owner'
  | 'duration'
  | 'note'
  | 'entry'
  | 'exit'
  | 'route'

/** 双方都改过且取值不同的字段 / 节点，并列成待核差异。 */
export type FieldDiff = {
  id: string
  field: MergeField
  /** route 差异对应的节点序号；其余字段为 -1。 */
  index: number
  smValue: unknown
  fdValue: unknown
  /** 裁决后记录采用的一端；未裁决前基线保留原值。 */
  resolved?: Role
}

/** 断网终端本地的一条操作（本机重试队列里的最小单元）。 */
export type SyncOp = {
  id: string
  role: Role
  cueId: string
  kind: 'field' | 'route-node' | 'route-append' | 'comment'
  field?: Exclude<MergeField, 'route'>
  value?: unknown
  index?: number
  point?: Point
  commentAuthor?: string
  commentContent?: string
  createdAt: number
  /** 已成功并入的操作保留记录，重试时用于去重，不再重复追加。 */
  applied?: boolean
  lastError?: string
}

export type MergeLogKind = 'direct' | 'diff' | 'dup' | 'comment'
export type MergeLogEntry = {
  cueId: string
  kind: MergeLogKind
  text: string
}

export type MergeReport = {
  cues: Cue[]
  logs: MergeLogEntry[]
  /** 命中互锁判断而冻结基线的提示编号。 */
  holdCueIds: string[]
  duplicateSkipped: number
}

export const FIELD_LABELS: Record<MergeField, string> = {
  time: '触发时间',
  title: '提示标题',
  scene: '场景',
  department: '执行部门',
  owner: '责任角色',
  duration: '时长',
  note: '执行说明',
  entry: '入场点',
  exit: '退场点',
  route: '路线节点',
}

/** 差异会影响互锁判断的字段（含路线坐标）。 */
const INTERLOCK_FIELDS: ReadonlySet<MergeField> = new Set<MergeField>([
  'time',
  'entry',
  'exit',
  'route',
])

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

export function formatPoint(point: Point): string {
  return `(${point.x}, ${point.y})`
}

export function formatValue(field: MergeField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）'
  if (field === 'entry' || field === 'exit') return formatPoint(value as Point)
  return String(value)
}

/** 两端各自对某字段 / 某节点的最新取值。 */
type SideChange = Partial<Record<Role, unknown>>

function diffId(cueId: string, field: MergeField, index: number): string {
  return `${cueId}:${field}:${index}`
}

/**
 * 网络恢复后的三方合并：
 * - 只有一端改过的字段直接并入；
 * - 两端都改过且不一致的字段（含路线节点坐标）并列保留为待核差异；
 * - 留言与路线追加按内容去重，不重复追加；
 * - 待核差异命中互锁判断时，冻结对应演出基线。
 */
export function mergeCues(base: Cue[], ops: SyncOp[]): MergeReport {
  const cues = structuredClone(base) as Cue[]
  const cueMap = new Map(cues.map((cue) => [cue.id, cue]))
  const sorted = [...ops].sort((a, b) => a.createdAt - b.createdAt)

  const fieldChanges = new Map<string, { sides: SideChange; cueId: string; field: Exclude<MergeField, 'route'> }>()
  const nodeChanges = new Map<string, { sides: SideChange; cueId: string; index: number }>()
  const logs: MergeLogEntry[] = []
  let duplicateSkipped = 0

  const changeKey = (cueId: string, field: string) => `${cueId}::${field}`
  const record = (
    map: typeof fieldChanges,
    cueId: string,
    field: Exclude<MergeField, 'route'>,
    role: Role,
    value: unknown,
  ) => {
    const key = changeKey(cueId, field)
    const entry = map.get(key) ?? { sides: {}, cueId, field }
    // 同一端的多次修改以最后一次为准
    entry.sides[role] = value
    map.set(key, entry)
  }

  // 留言按 提示+作者+内容 去重（基线已有留言也计入）
  const commentSeen = new Set<string>()
  const commentKey = (cueId: string, author: string, content: string) => `${cueId}|${author}|${content}`
  cues.forEach((cue) =>
    cue.comments.forEach((comment) => commentSeen.add(commentKey(cue.id, comment.author, comment.content))),
  )

  // 各端追加的路线节点（按操作时间保序），跨端重复坐标只追加一次
  const appended = new Map<string, SyncOp[]>()

  for (const op of sorted) {
    const cue = cueMap.get(op.cueId)
    if (!cue) continue

    if (op.kind === 'field' && op.field) {
      record(fieldChanges, op.cueId, op.field, op.role, op.value)
      continue
    }

    if (op.kind === 'route-node' && typeof op.index === 'number') {
      const key = `${op.cueId}::${op.index}`
      const entry = nodeChanges.get(key) ?? { sides: {}, cueId: op.cueId, index: op.index }
      entry.sides[op.role] = op.point
      nodeChanges.set(key, entry)
      continue
    }

    if (op.kind === 'route-append' && op.point) {
      const list = appended.get(op.cueId) ?? []
      const duplicatedByRole = list.some((item) => item.role === op.role && item.point && samePoint(item.point, op.point!))
      const duplicatedCrossRole = list.some((item) => item.role !== op.role && item.point && samePoint(item.point, op.point!))
      if (duplicatedByRole) {
        duplicateSkipped += 1
        logs.push({
          cueId: op.cueId,
          kind: 'dup',
          text: `${op.role}重复追加节点 ${formatPoint(op.point)}，已去重`,
        })
        continue
      }
      if (duplicatedCrossRole) {
        duplicateSkipped += 1
        logs.push({
          cueId: op.cueId,
          kind: 'dup',
          text: `两端都追加节点 ${formatPoint(op.point)}，只保留一个`,
        })
        continue
      }
      list.push(op)
      appended.set(op.cueId, list)
      continue
    }

    if (op.kind === 'comment' && op.commentAuthor && op.commentContent) {
      const key = commentKey(op.cueId, op.commentAuthor, op.commentContent)
      if (commentSeen.has(key)) {
        duplicateSkipped += 1
        logs.push({ cueId: op.cueId, kind: 'dup', text: `留言「${op.commentContent}」两端重复，只保留一条` })
        continue
      }
      commentSeen.add(key)
      cue.comments.push({
        id: `m${op.id}`,
        author: op.commentAuthor,
        content: op.commentContent,
        createdAt: new Date(op.createdAt).toLocaleString('zh-CN'),
        resolved: false,
      })
      logs.push({ cueId: op.cueId, kind: 'comment', text: `${op.role}留言已并入` })
    }
  }

  // 应用标量字段
  for (const { sides, cueId, field } of fieldChanges.values()) {
    const cue = cueMap.get(cueId)
    if (!cue) continue
    const sm = sides['舞台监督']
    const fd = sides['前场导演']
    const smChanged = Object.prototype.hasOwnProperty.call(sides, '舞台监督')
    const fdChanged = Object.prototype.hasOwnProperty.call(sides, '前场导演')

    if (smChanged && (!fdChanged || deepEqual(sm, fd))) {
      ;(cue as Record<string, unknown>)[field] = sm
      logs.push({ cueId, kind: 'direct', text: `${FIELD_LABELS[field]}按舞台监督端并入：${formatValue(field, sm)}` })
    } else if (fdChanged && !smChanged) {
      ;(cue as Record<string, unknown>)[field] = fd
      logs.push({ cueId, kind: 'direct', text: `${FIELD_LABELS[field]}按前场导演端并入：${formatValue(field, fd)}` })
    } else {
      // 两端都改过且不一致：并列成待核差异，基线保留原值
      cue.pendingDiffs = upsertDiff(cue.pendingDiffs, {
        id: diffId(cueId, field, -1),
        field,
        index: -1,
        smValue: sm,
        fdValue: fd,
      })
      logs.push({
        cueId,
        kind: 'diff',
        text: `${FIELD_LABELS[field]}两端不一致，待人工核对（${formatValue(field, sm)} / ${formatValue(field, fd)}）`,
      })
    }
  }

  // 应用已有路线节点坐标
  for (const { sides, cueId, index } of nodeChanges.values()) {
    const cue = cueMap.get(cueId)
    const node = cue?.route[index]
    if (!cue || !node) continue
    const sm = sides['舞台监督'] as Point | undefined
    const fd = sides['前场导演'] as Point | undefined
    const smChanged = sm !== undefined
    const fdChanged = fd !== undefined

    if (smChanged && (!fdChanged || samePoint(sm, fd))) {
      node.x = sm.x
      node.y = sm.y
      node.altX = undefined
      node.altY = undefined
      node.altRole = undefined
      logs.push({ cueId, kind: 'direct', text: `节点 ${index + 1} 按舞台监督端并入 ${formatPoint(sm)}` })
    } else if (fdChanged && !smChanged) {
      node.x = fd.x
      node.y = fd.y
      node.altX = undefined
      node.altY = undefined
      node.altRole = undefined
      logs.push({ cueId, kind: 'direct', text: `节点 ${index + 1} 按前场导演端并入 ${formatPoint(fd)}` })
    } else if (sm && fd && !samePoint(sm, fd)) {
      // 两端坐标并列：主坐标取舞台监督端，alt 保留前场导演端
      node.x = sm.x
      node.y = sm.y
      node.altX = fd.x
      node.altY = fd.y
      node.altRole = '前场导演'
      cue.pendingDiffs = upsertDiff(cue.pendingDiffs, {
        id: diffId(cueId, 'route', index),
        field: 'route',
        index,
        smValue: sm,
        fdValue: fd,
      })
      logs.push({
        cueId,
        kind: 'diff',
        text: `节点 ${index + 1} 坐标不一致：舞台监督 ${formatPoint(sm)} / 前场导演 ${formatPoint(fd)}，待核`,
      })
    }
  }

  // 追加新节点（已跨端去重），追加不产生待核差异
  for (const [cueId, list] of appended) {
    const cue = cueMap.get(cueId)
    if (!cue) continue
    for (const op of list) {
      if (!op.point) continue
      cue.route.push({ x: op.point.x, y: op.point.y })
      logs.push({ cueId, kind: 'direct', text: `${op.role}追加路线节点 ${formatPoint(op.point)}` })
    }
  }

  const holdCueIds = cues.filter((cue) => cue.interlock && hasBlockingDiff(cue)).map((cue) => cue.id)

  return { cues, logs, holdCueIds, duplicateSkipped }
}

function upsertDiff(diffs: FieldDiff[] | undefined, diff: FieldDiff): FieldDiff[] {
  const list = diffs ? diffs.filter((item) => item.id !== diff.id) : []
  list.push(diff)
  return list
}

/** 待核差异是否落在会影响互锁判断的字段上。 */
export function hasBlockingDiff(cue: Cue): boolean {
  return (cue.pendingDiffs ?? []).some((diff) => INTERLOCK_FIELDS.has(diff.field) && !diff.resolved)
}

export function pendingDiffCount(cue: Cue): number {
  return (cue.pendingDiffs ?? []).filter((diff) => !diff.resolved).length
}

/**
 * 人工裁决一项待核差异：采用指定一端的取值，清空并列坐标。
 * 返回基线是否仍需冻结（存在命中互锁的未决差异）。
 */
export function resolveDiff(cues: Cue[], cueId: string, diff: FieldDiff, side: Role): boolean {
  const cue = cues.find((item) => item.id === cueId)
  if (!cue) return cues.some((item) => item.interlock && hasBlockingDiff(item))
  const chosen = side === '舞台监督' ? diff.smValue : diff.fdValue

  if (diff.field === 'route' && diff.index >= 0) {
    const node = cue.route[diff.index]
    const point = chosen as Point
    if (node && point) {
      node.x = point.x
      node.y = point.y
      node.altX = undefined
      node.altY = undefined
      node.altRole = undefined
    }
  } else if (diff.field !== 'route') {
    ;(cue as Record<string, unknown>)[diff.field] = chosen
  }

  cue.pendingDiffs = (cue.pendingDiffs ?? []).map((item) =>
    item.id === diff.id ? { ...item, resolved: side } : item,
  )
  return cues.some((item) => item.interlock && hasBlockingDiff(item))
}

export function cueInterlock(cue: Cue): boolean {
  return Boolean(cue.interlock)
}
