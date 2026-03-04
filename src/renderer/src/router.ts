import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/library'
  },
  {
    path: '/library',
    name: 'Library',
    component: () => import('./views/Library.vue'),
    meta: { title: '题库管理' }
  },
  {
    path: '/import',
    name: 'Import',
    component: () => import('./views/Import.vue'),
    meta: { title: 'AI导入' }
  },
  {
    path: '/practice',
    name: 'Practice',
    component: () => import('./views/Practice.vue'),
    meta: { title: '做题练习' }
  },
  {
    path: '/practice-history',
    name: 'PracticeHistory',
    component: () => import('./views/PracticeHistory.vue'),
    meta: { title: '成绩记录' }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('./views/Settings.vue'),
    meta: { title: '设置' }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router