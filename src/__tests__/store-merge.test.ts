// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkshopStore } from '../stores/workshop'

describe('离线协同合并流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('两边改同一提示的不同字段，联网后直接并入', () => {
    const store = useWorkshopStore()
    store.goOffline()

    // 舞台监督改 C-01 的入场点
    store.setRole('stage-manager')
    store.selectedId = 'C-01'
    store.updateCue({ entry: { x: 12, y: 72 } })

    // 前场导演改 C-01 的触发时间
    store.setRole('foh-director')
    store.selectedId = 'C-01'
    store.updateCue({ time: '00:05:00' })

    // 联网合并
    store.goOnline()

    const cue = store.cues.find((c) => c.id === 'C-01')!
    expect(cue.entry.x).toBe(12)
    expect(cue.time).toBe('00:05:00')
    expect(store.pendingOps.length).toBe(0)
  })

  it('两边改同一路线节点，保留两种坐标并列成待核差异', () => {
    const store = useWorkshopStore()
    store.goOffline()

    store.setRole('stage-manager')
    store.selectedId = 'C-01'
    store.updateRouteNode(1, { x: 36, y: 61 })

    store.setRole('foh-director')
    store.selectedId = 'C-01'
    store.updateRouteNode(1, { x: 34, y: 59 })

    store.goOnline()

    const cue = store.cues.find((c) => c.id === 'C-01')!
    expect(cue.route[1].x).toBe(36)
    expect(cue.route[1].pair).toBeDefined()
    expect(cue.route[1].pair!.x).toBe(34)
    expect(store.cueDiffs('C-01').length).toBe(1)
  })

  it('互锁提示的路线差异令基线停住，打印保留旧版', () => {
    const store = useWorkshopStore()
    store.goOffline()

    store.setRole('stage-manager')
    store.selectedId = 'C-04'
    store.updateRouteNode(0, { x: 51, y: 13 })

    store.setRole('foh-director')
    store.selectedId = 'C-04'
    store.updateRouteNode(0, { x: 49, y: 11 })

    store.goOnline()

    expect(store.halted).toBe(true)
    expect(store.interlockDiffs.length).toBeGreaterThan(0)
    // 打印中心保留旧版清单（基线未变）
    const printCue = store.printCues.find((c) => c.id === 'C-04')!
    expect(printCue.route[0].x).toBe(50)
    // 舞台上的基线仍是旧版
    const stageCue = store.cues.find((c) => c.id === 'C-04')!
    expect(stageCue.route[0].x).toBe(50)
  })

  it('合并失败后队列留着重试，留言和路线不重复追加', () => {
    const store = useWorkshopStore()
    store.goOffline()

    store.setRole('stage-manager')
    store.selectedId = 'C-01'
    store.addComment('舞台监督的留言')
    store.addWaypoint({ x: 50, y: 50 })

    // 模拟合并失败
    store.forceMergeFailure = true
    store.goOnline()

    expect(store.pendingOps.length).toBe(1)
    expect(store.pendingOps[0].status).toBe('failed')
    expect(store.pendingOps[0].attempts).toBe(1)

    // 重试成功
    store.forceMergeFailure = false
    store.retryMerge()

    expect(store.pendingOps.length).toBe(0)
    const cue = store.cues.find((c) => c.id === 'C-01')!
    expect(cue.comments.filter((c) => c.content === '舞台监督的留言').length).toBe(1)
    expect(cue.route.length).toBe(4) // 3 基线 + 1 追加
  })

  it('基线锁定后的改动另开修订稿', () => {
    const store = useWorkshopStore()
    store.lockBaseline()
    expect(store.locked).toBe(true)

    // 锁定后修改进入修订稿
    store.selectedId = 'C-01'
    store.updateCue({ title: '修订后的标题' })

    expect(store.hasRevisionDraft).toBe(true)
    expect(store.revisionDraft).not.toBeNull()
    // 锁定基线不变
    expect(store.cues.find((c) => c.id === 'C-01')!.title).toBe('林默从左侧门入场')
    // 修订稿包含修改
    expect(store.revisionDraft!.find((c) => c.id === 'C-01')!.title).toBe('修订后的标题')
  })

  it('解决互锁差异后基线恢复并并入', () => {
    const store = useWorkshopStore()
    store.goOffline()

    store.setRole('stage-manager')
    store.selectedId = 'C-04'
    store.updateRouteNode(0, { x: 51, y: 13 })

    store.setRole('foh-director')
    store.selectedId = 'C-04'
    store.updateRouteNode(0, { x: 49, y: 11 })

    store.goOnline()
    expect(store.halted).toBe(true)

    // 采用舞台监督的坐标
    store.resolveDiff('C-04', 'route', 0, 'local')

    expect(store.halted).toBe(false)
    const cue = store.cues.find((c) => c.id === 'C-04')!
    expect(cue.route[0].x).toBe(51)
    expect(cue.route[0].pair).toBeUndefined()
  })
})
