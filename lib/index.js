// 结构台 · 宿主半边入口
// 两件事：挂 HTTP 口子（浏览器半边用）、注册一个智能体工具（和面板改同一份盘上的板子）。
import { API_PREFIX, createApi } from './api.js'
import { DEFAULT_DATA_DIR } from './store.js'
import { registerTools } from './tools.js'

export const name = 'structure-desk'
export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const dataDir = () => (config && typeof config.dataDir === 'string' && config.dataDir.trim()) || DEFAULT_DATA_DIR
  // 口子与工具都挂在 apply 的 effect 上：插件卸载时一起收干净
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: createApi({ dataDir }),
    })
    const disposeTools = registerTools(ctx, { dataDir })
    return () => {
      try {
        disposeTools()
      } catch {
        // 工具服务先卸载时这里会拿不到，忽略
      }
      disposeRoute()
    }
  })
}
