import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的API
const electronAPI = {
  // 数据库操作
  db: {
    getQuestions: (filters?: any) => ipcRenderer.invoke('db:getQuestions', filters),
    addQuestion: (question: any) => ipcRenderer.invoke('db:addQuestion', question),
    updateQuestion: (question: any) => ipcRenderer.invoke('db:updateQuestion', question),
    deleteQuestion: (id: number) => ipcRenderer.invoke('db:deleteQuestion', id),
    getCategories: () => ipcRenderer.invoke('db:getCategories'),
    addCategory: (name: string, parentId?: number) => ipcRenderer.invoke('db:addCategory', name, parentId),
    createPracticeSession: (session: any) => ipcRenderer.invoke('db:createPracticeSession', session),
    addPracticeRecords: (records: any[]) => ipcRenderer.invoke('db:addPracticeRecords', records),
    getPracticeSessions: (filters?: any) => ipcRenderer.invoke('db:getPracticeSessions', filters),
    getPracticeSessionDetails: (sessionId: number) => ipcRenderer.invoke('db:getPracticeSessionDetails', sessionId),
    savePracticeResult: (payload: any) => ipcRenderer.invoke('db:savePracticeResult', payload)
  },

  // 文件操作
  file: {
    selectPdf: () => ipcRenderer.invoke('file:selectPdf'),
    readPdf: (filePath: string) => ipcRenderer.invoke('file:readPdf', filePath),
    extractPdfText: (filePath: string) => ipcRenderer.invoke('file:extractPdfText', filePath),
    onExtractPdfTextProgress: (callback: (payload: { filePath: string; stage: 'text' | 'ocr'; page?: number; totalPages?: number; message: string }) => void) => {
      const listener = (_event: unknown, payload: { filePath: string; stage: 'text' | 'ocr'; page?: number; totalPages?: number; message: string }) => callback(payload)
      ipcRenderer.on('file:extractPdfTextProgress', listener)
      return () => ipcRenderer.removeListener('file:extractPdfTextProgress', listener)
    }
  },

  // AI 服务
  ai: {
    extractQuestions: (text: string, config: any) => ipcRenderer.invoke('ai:extractQuestions', text, config)
  },

  // 配置管理
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config: any) => ipcRenderer.invoke('config:save', config),
    test: (config: any) => ipcRenderer.invoke('config:test', config)
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)