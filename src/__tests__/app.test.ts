// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { VueQueryPlugin } from '@tanstack/vue-query'
import ElementPlus from 'element-plus'
import App from '../App.vue'
import OverviewView from '../views/OverviewView.vue'
import StageView from '../views/StageView.vue'
import ScriptView from '../views/ScriptView.vue'
import SyncView from '../views/SyncView.vue'
import PrintView from '../views/PrintView.vue'

function mountApp() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', component: OverviewView },
      { path: '/stage', component: StageView },
      { path: '/script', component: ScriptView },
      { path: '/sync', component: SyncView },
      { path: '/print', component: PrintView },
    ],
  })
  return mount(App, {
    global: {
      plugins: [createPinia(), router, VueQueryPlugin],
    },
  })
}

describe('App 渲染', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('渲染导航与品牌', () => {
    const wrapper = mountApp()
    expect(wrapper.text()).toContain('离线协同')
    expect(wrapper.text()).toContain('舞台走位')
    expect(wrapper.text()).toContain('巡演总览')
  })

  it('渲染角色切换按钮', () => {
    const wrapper = mountApp()
    expect(wrapper.text()).toContain('舞台监督')
    expect(wrapper.text()).toContain('前场导演')
  })
})

describe('离线协同流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('协同页渲染本机队列与待核差异', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: OverviewView },
        { path: '/sync', component: SyncView },
      ],
    })
    const wrapper = mount(SyncView, {
      global: { plugins: [createPinia(), router] },
    })
    await router.isReady()
    expect(wrapper.text()).toContain('本机队列')
    expect(wrapper.text()).toContain('待核差异')
    expect(wrapper.text()).toContain('合并日志')
  })

  it('舞台页渲染平面图与节点卡片', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: OverviewView }, { path: '/stage', component: StageView }],
    })
    const wrapper = mount(StageView, {
      global: { plugins: [createPinia(), router] },
    })
    await router.isReady()
    expect(wrapper.text()).toContain('走位编排')
    expect(wrapper.findAll('.cue-card').length).toBeGreaterThan(0)
    expect(wrapper.find('.stage-svg').exists()).toBe(true)
  })

  it('打印页渲染执行清单', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/', component: OverviewView }, { path: '/print', component: PrintView }],
    })
    const wrapper = mount(PrintView, {
      global: { plugins: [createPinia(), router] },
    })
    await router.isReady()
    expect(wrapper.text()).toContain('执行清单')
    expect(wrapper.findAll('.print-sheet tbody tr').length).toBeGreaterThan(0)
  })
})
