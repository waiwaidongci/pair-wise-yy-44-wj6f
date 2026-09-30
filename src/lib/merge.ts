import type { Comment, Cue, Point } from '../stores/workshop'

export type Role = 'stage-manager' | 'foh-director'

export const ROLE_LABELS: Record<Role, string> = {
  'stage-manager': '舞台监督',
  'foh-director': '前场导演',
}

export const ROLE_COLORS: Record<Role, string> = {
  'stage-manager': '#2f8580',
  'foh-director': '#c36e23',
}

export type FieldChange = { from: unknown; to: unknown }

export type OfflineOp = {
  opId: string
  cueId: string
  role: Role
  savedAt: string
  baseRevision: number
  fields: Record<string, FieldChange>
  routeNodes: Record<number, FieldChange>
  routeAppends: Array<{ clientId: string; point: Point }>
  commentAppends: Array<{ clientId: string; comment: Comment }>
  status: 'pending' | 'merged' | 'failed'
  attempts: number
  lastError?: string
}

export type FieldDiff = {
  field: string
  label: string
  nodeIndex?: number
  localValue: unknown
  remoteValue: unknown
  status: 'pending' | 'local' | 'remote'
  interlockAffected: boolean
}

export type CueMergeResult = {
  cueId: string
  merged: Cue
  diffs: FieldDiff[]
  interlockAffected: boolean
}

export type MergeResult = {
  cues: Cue[]
  results: CueMergeResult[]
  halted: boolean
  errors: string[]
}

const FIELD_LABELS: Record<string, string> = {
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

const INTERLOCK_FIELDS = new Set(['route', 'time'])

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function pointEqual(a: Point | undefined, b: Point | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y
}

/**
 * Consolidate one role's offline ops for a single cue into a draft cue.
 * Appends are applied only when their clientId is not already in `applied`,
 * which keeps retries idempotent (no duplicate comments / route nodes).
 */
export function consolidateDraft(
  base: Cue,
  ops: OfflineOp[],
  applied: Set<string>,
): Cue {
  const draft = clone(base)
  const sorted = [...ops].sort((a, b) => a.savedAt.localeCompare(b.savedAt))
  for (const op of sorted) {
    for (const [field, change] of Object.entries(op.fields)) {
      ;(draft as Record<string, unknown>)[field] = change.to
    }
    for (const [indexStr, change] of Object.entries(op.routeNodes)) {
      const index = Number(indexStr)
      if (draft.route[index]) draft.route[index] = change.to as Point
    }
    for (const append of op.routeAppends) {
      if (applied.has(append.clientId)) continue
      draft.route.push({ ...append.point, clientId: append.clientId })
      applied.add(append.clientId)
    }
    for (const append of op.commentAppends) {
      if (applied.has(append.clientId)) continue
      draft.comments.push(append.comment)
      applied.add(append.clientId)
    }
  }
  return draft
}

/** Compute the field-level diff between a baseline cue and an edited draft. */
export function diffCue(base: Cue, draft: Cue) {
  const fields: Record<string, FieldChange> = {}
  for (const field of SCALAR_FIELDS) {
    const before = (base as Record<string, unknown>)[field]
    const after = (draft as Record<string, unknown>)[field]
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fields[field] = { from: clone(before), to: clone(after) }
    }
  }

  const routeNodes: Record<number, FieldChange> = {}
  for (let i = 0; i < base.route.length; i++) {
    const before = base.route[i]
    const after = draft.route[i]
    if (after && !pointEqual(before, after)) {
      routeNodes[i] = { from: clone(before), to: clone(after) }
    }
  }

  const routeAppends = draft.route
    .slice(base.route.length)
    .filter((point) => point.clientId)
    .map((point) => ({ clientId: point.clientId as string, point: { x: point.x, y: point.y } }))

  const baseCommentIds = new Set(base.comments.map((comment) => comment.id))
  const commentAppends = draft.comments
    .filter((comment) => !baseCommentIds.has(comment.id))
    .map((comment) => ({ clientId: comment.id, comment: clone(comment) }))

  return { fields, routeNodes, routeAppends, commentAppends }
}

function changedScalarFields(base: Cue, draft: Cue): Set<string> {
  const changed = new Set<string>()
  for (const field of SCALAR_FIELDS) {
    if (JSON.stringify((base as Record<string, unknown>)[field]) !== JSON.stringify((draft as Record<string, unknown>)[field])) {
      changed.add(field)
    }
  }
  if (base.route.length !== draft.route.length) {
    changed.add('route')
  } else {
    for (let i = 0; i < base.route.length; i++) {
      if (!pointEqual(base.route[i], draft.route[i])) {
        changed.add('route')
        break
      }
    }
  }
  return changed
}

function interlockAffected(cue: Cue, field: string): boolean {
  return cue.interlocked === true && INTERLOCK_FIELDS.has(field)
}

/**
 * Three-way merge of two roles' offline drafts against the shared baseline.
 * - Fields changed by only one side merge directly.
 * - Route nodes changed by both sides keep both coordinates side by side as a
 *   pending-review diff; other fields changed by both sides also become a diff.
 * - Appended comments / route nodes are unioned by clientId (idempotent).
 * - A diff touching an interlocked cue's route or time halts the baseline.
 */
export function threeWayMerge(
  base: Cue[],
  localOps: OfflineOp[],
  remoteOps: OfflineOp[],
  appliedClientIds: Set<string>,
): MergeResult {
  const localDrafts = new Map<string, Cue>()
  const remoteDrafts = new Map<string, Cue>()
  for (const cue of base) {
    localDrafts.set(cue.id, consolidateDraft(cue, localOps.filter((op) => op.cueId === cue.id), new Set(appliedClientIds)))
    remoteDrafts.set(cue.id, consolidateDraft(cue, remoteOps.filter((op) => op.cueId === cue.id), new Set(appliedClientIds)))
  }

  const results: CueMergeResult[] = []
  let halted = false

  for (const cue of base) {
    const local = localDrafts.get(cue.id) ?? cue
    const remote = remoteDrafts.get(cue.id) ?? cue
    const localChanged = changedScalarFields(cue, local)
    const remoteChanged = changedScalarFields(cue, remote)
    const merged = clone(cue)
    const diffs: FieldDiff[] = []

    const allFields = new Set([...localChanged, ...remoteChanged])
    for (const field of allFields) {
      const inLocal = localChanged.has(field)
      const inRemote = remoteChanged.has(field)
      const affectsInterlock = interlockAffected(cue, field)

      if (inLocal && inRemote) {
        if (field === 'route') {
          mergeRoute(cue, local, remote, merged, diffs, affectsInterlock)
        } else {
          const localValue = (local as Record<string, unknown>)[field]
          const remoteValue = (remote as Record<string, unknown>)[field]
          if (JSON.stringify(localValue) === JSON.stringify(remoteValue)) {
            ;(merged as Record<string, unknown>)[field] = clone(localValue)
          } else {
            diffs.push({
              field,
              label: FIELD_LABELS[field] ?? field,
              localValue,
              remoteValue,
              status: 'pending',
              interlockAffected: affectsInterlock,
            })
            ;(merged as Record<string, unknown>)[field] = clone(localValue)
          }
        }
      } else if (inLocal) {
        if (field === 'route') merged.route = clone(local.route)
        else (merged as Record<string, unknown>)[field] = clone((local as Record<string, unknown>)[field])
      } else if (inRemote) {
        if (field === 'route') merged.route = clone(remote.route)
        else (merged as Record<string, unknown>)[field] = clone((remote as Record<string, unknown>)[field])
      }
    }

    mergeComments(cue, local, remote, merged)

    const cueInterlock = diffs.some((diff) => diff.interlockAffected)
    if (cueInterlock) halted = true
    results.push({ cueId: cue.id, merged, diffs, interlockAffected: cueInterlock })
  }

  // Cues created offline by either side (not present in the baseline).
  for (const [id, draft] of [...localDrafts, ...remoteDrafts]) {
    if (base.some((cue) => cue.id === id)) continue
    if (results.some((result) => result.cueId === id)) continue
    results.push({ cueId: id, merged: clone(draft), diffs: [], interlockAffected: false })
  }

  return { cues: results.map((result) => result.merged), results, halted, errors: [] }
}

function mergeRoute(
  base: Cue,
  local: Cue,
  remote: Cue,
  merged: Cue,
  diffs: FieldDiff[],
  affectsInterlock: boolean,
) {
  const baseLen = base.route.length
  const mergedRoute: Point[] = []

  for (let i = 0; i < baseLen; i++) {
    const before = base.route[i]
    const localPoint = local.route[i]
    const remotePoint = remote.route[i]
    const localChanged = localPoint && !pointEqual(before, localPoint)
    const remoteChanged = remotePoint && !pointEqual(before, remotePoint)

    if (localChanged && remoteChanged) {
      if (pointEqual(localPoint, remotePoint)) {
        mergedRoute.push(clone(localPoint))
      } else {
        diffs.push({
          field: 'route',
          label: `路线节点 ${i}`,
          nodeIndex: i,
          localValue: clone(localPoint),
          remoteValue: clone(remotePoint),
          status: 'pending',
          interlockAffected: affectsInterlock,
        })
        mergedRoute.push({ ...clone(localPoint), pair: clone(remotePoint) })
      }
    } else if (localChanged) {
      mergedRoute.push(clone(localPoint))
    } else if (remoteChanged) {
      mergedRoute.push(clone(remotePoint))
    } else {
      mergedRoute.push(clone(before))
    }
  }

  // Appended nodes (beyond baseline length) are unioned by clientId.
  const seen = new Set<string>()
  for (const point of mergedRoute) {
    if (point.clientId) seen.add(point.clientId)
  }
  for (const side of [local, remote]) {
    for (let i = baseLen; i < side.route.length; i++) {
      const point = side.route[i]
      if (point.clientId && seen.has(point.clientId)) continue
      mergedRoute.push(clone(point))
      if (point.clientId) seen.add(point.clientId)
    }
  }

  merged.route = mergedRoute
}

function mergeComments(base: Cue, local: Cue, remote: Cue, merged: Cue) {
  const byId = new Map<string, Comment>()
  for (const comment of base.comments) byId.set(comment.id, comment)
  for (const comment of local.comments) if (!byId.has(comment.id)) byId.set(comment.id, comment)
  for (const comment of remote.comments) if (!byId.has(comment.id)) byId.set(comment.id, comment)
  merged.comments = [...byId.values()]
}

/** Resolve a single pending diff to one side, returning a new result set. */
export function resolveDiff(
  results: CueMergeResult[],
  cueId: string,
  field: string,
  nodeIndex: number | undefined,
  choice: 'local' | 'remote',
): CueMergeResult[] {
  return results.map((result) => {
    if (result.cueId !== cueId) return result
    const merged = clone(result.merged)
    const diffs = result.diffs.map((diff) => {
      if (diff.field !== field || diff.nodeIndex !== nodeIndex) return diff
      const value = choice === 'local' ? diff.localValue : diff.remoteValue
      if (field === 'route' && nodeIndex !== undefined) {
        merged.route[nodeIndex] = clone(value as Point)
        delete merged.route[nodeIndex].pair
      } else {
        ;(merged as Record<string, unknown>)[field] = clone(value)
      }
      return { ...diff, status: choice as 'local' | 'remote' }
    })
    return {
      ...result,
      merged,
      diffs,
      interlockAffected: diffs.some((diff) => diff.interlockAffected && diff.status === 'pending'),
    }
  })
}

export function isHalted(results: CueMergeResult[]): boolean {
  return results.some((result) => result.interlockAffected)
}

export function pendingDiffCount(results: CueMergeResult[]): number {
  return results.reduce((total, result) => total + result.diffs.filter((diff) => diff.status === 'pending').length, 0)
}
