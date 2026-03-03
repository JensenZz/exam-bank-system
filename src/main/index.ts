import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import axios from 'axios'

// 数据库实例
let db: Database | null = null
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    frame: false, // 无边框窗口
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    require('electron').shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式下打开DevTools
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 初始化数据库
function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'exam-bank.db')
  db = new Database(dbPath)

  // 创建题目表
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      type TEXT DEFAULT 'single',  -- single: 单选, multiple: 多选, fill: 填空, essay: 简答
      options TEXT,  -- JSON格式存储选项
      answer TEXT NOT NULL,
      analysis TEXT,
      images TEXT,  -- JSON格式存储图片路径
      category_id INTEGER,
      difficulty INTEGER DEFAULT 1,
      source TEXT,  -- 来源
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 创建分类表
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 创建标签表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 创建题目-标签关联表
  db.exec(`
    CREATE TABLE IF NOT EXISTS question_tags (
      question_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (question_id, tag_id)
    )
  `)

  // 创建做题记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS practice_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      user_answer TEXT,
      is_correct INTEGER,
      practiced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  console.log('数据库初始化完成:', dbPath)
}

// IPC处理 - 数据库操作
ipcMain.handle('db:getQuestions', (_, filters) => {
  if (!db) return []
  let sql = 'SELECT * FROM questions WHERE 1=1'
  const params: any[] = []

  if (filters?.categoryId) {
    sql += ' AND category_id = ?'
    params.push(filters.categoryId)
  }
  if (filters?.type) {
    sql += ' AND type = ?'
    params.push(filters.type)
  }
  if (filters?.keyword) {
    sql += ' AND (title LIKE ? OR content LIKE ?)'
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`)
  }

  sql += ' ORDER BY created_at DESC'
  if (filters?.limit) {
    sql += ' LIMIT ?'
    params.push(filters.limit)
  }

  return db.prepare(sql).all(...params)
})

ipcMain.handle('db:addQuestion', (_, question) => {
  if (!db) return null

  const safeQuestion = {
    title: String(question?.title || ''),
    content: String(question?.content || ''),
    type: String(question?.type || 'single'),
    options: Array.isArray(question?.options) ? question.options.map((item: unknown) => String(item)) : [],
    answer: String(question?.answer || ''),
    analysis: String(question?.analysis || ''),
    images: Array.isArray(question?.images) ? question.images.map((item: unknown) => String(item)) : [],
    categoryId: Number.isFinite(Number(question?.categoryId)) ? Number(question?.categoryId) : undefined,
    difficulty: Number.isFinite(Number(question?.difficulty)) ? Number(question?.difficulty) : 1,
    source: String(question?.source || '')
  }

  const stmt = db.prepare(`
    INSERT INTO questions (title, content, type, options, answer, analysis, images, category_id, difficulty, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    safeQuestion.title,
    safeQuestion.content,
    safeQuestion.type,
    JSON.stringify(safeQuestion.options),
    safeQuestion.answer,
    safeQuestion.analysis,
    JSON.stringify(safeQuestion.images),
    safeQuestion.categoryId,
    safeQuestion.difficulty,
    safeQuestion.source
  )

  return {
    id: Number(result.lastInsertRowid),
    ...safeQuestion
  }
})

ipcMain.handle('db:updateQuestion', (_, question) => {
  if (!db) return null
  const stmt = db.prepare(`
    UPDATE questions SET
      title = ?, content = ?, type = ?, options = ?, answer = ?,
      analysis = ?, images = ?, category_id = ?, difficulty = ?, source = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
  stmt.run(
    question.title,
    question.content,
    question.type,
    JSON.stringify(question.options),
    question.answer,
    question.analysis,
    JSON.stringify(question.images || []),
    question.categoryId,
    question.difficulty,
    question.source,
    question.id
  )
  return question
})

ipcMain.handle('db:deleteQuestion', (_, id) => {
  if (!db) return false
  db.prepare('DELETE FROM questions WHERE id = ?').run(id)
  return true
})

ipcMain.handle('db:getCategories', () => {
  if (!db) return []
  return db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all()
})

ipcMain.handle('db:addCategory', (_, name, parentId = 0) => {
  if (!db) return null
  const result = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run(name, parentId)
  return { id: Number(result.lastInsertRowid), name, parent_id: parentId }
})

// IPC处理 - 文件操作
ipcMain.handle('file:selectPdf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win!, {
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled) return []
  return result.filePaths
})

ipcMain.handle('file:readPdf', async (_, filePath: string) => {
  // TODO: 使用pdf-lib解析PDF并返回图片
  const buffer = fs.readFileSync(filePath)
  return buffer.toString('base64')
})

// PDF 文本提取
ipcMain.handle('file:extractPdfText', async (event, filePath: string) => {
  const { extractPdfText } = await import('./pdfProcessor.js')
  return extractPdfText(filePath, (payload) => {
    event.sender.send('file:extractPdfTextProgress', payload)
  })
})

// AI 题目提取
ipcMain.handle('ai:extractQuestions', async (_, text: string, config: any) => {
  const { AiService } = await import('./aiService.js')
  const service = new AiService(config)
  return service.extractQuestions(text)
})

// 配置管理
ipcMain.handle('config:load', async () => {
  const { configManager } = await import('./configManager.js')
  return configManager.loadConfig()
})

ipcMain.handle('config:save', async (_, config: any) => {
  const { configManager } = await import('./configManager.js')
  await configManager.saveConfig(config)
  return { success: true }
})

ipcMain.handle('config:test', async (_, config: any) => {
  try {
    const endpoint = config.endpoint || (
      config.provider === 'aliyun'
        ? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
        : config.provider === 'baidu'
          ? 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions'
          : 'https://api.openai.com/v1/chat/completions'
    )

    // 自动补全 /chat/completions 路径
    const finalEndpoint = endpoint.endsWith('/chat/completions')
      ? endpoint
      : endpoint.replace(/\/$/, '') + '/chat/completions'

    console.log('[config:test] provider:', config.provider)
    console.log('[config:test] endpoint:', finalEndpoint)
    console.log('[config:test] model:', config.model)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.provider !== 'baidu') {
      headers['Authorization'] = `Bearer ${config.apiKey}`
    }

    let body: any
    if (config.provider === 'aliyun') {
      body = {
        model: config.model,
        input: { messages: [{ role: 'user', content: 'hi' }] },
        parameters: { max_tokens: 10 }
      }
    } else {
      body = {
        model: config.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10
      }
    }

    const axiosConfig: any = { headers, timeout: 15000 }
    if (config.provider === 'baidu') {
      axiosConfig.params = { access_token: config.apiKey }
    }

    const response = await axios.post(finalEndpoint, body, axiosConfig)
    console.log('[config:test] response status:', response.status)
    return { success: true, status: response.status }
  } catch (error: any) {
    const status = error.response?.status ?? null
    const message: string = error.response?.data?.error?.message || error.response?.data?.message || error.message || '未知错误'
    console.log('[config:test] error status:', status, 'message:', message)
    return { success: false, status, message }
  }
})

// 窗口控制
ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win?.isMaximized()) {
    win.unmaximize()
  } else {
    win?.maximize()
  }
})

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})

// App lifecycle
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.exam-bank-system')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close()
    app.quit()
  }
})