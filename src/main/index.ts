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

function columnExists(tableName: string, columnName: string): boolean {
  if (!db) return false
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return columns.some((column) => column.name === columnName)
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  if (!db) return
  if (!columnExists(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`)
  }
}

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

  // 创建练习会话表
  db.exec(`
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_year INTEGER,
      exam_level TEXT,
      qualification_name TEXT,
      total_count INTEGER NOT NULL,
      correct_count INTEGER NOT NULL,
      accuracy REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // 增量迁移（幂等）
  ensureColumn('questions', 'exam_year', 'exam_year INTEGER')
  ensureColumn('questions', 'exam_level', 'exam_level TEXT')
  ensureColumn('questions', 'qualification_name', 'qualification_name TEXT')

  ensureColumn('practice_records', 'session_id', 'session_id INTEGER')
  ensureColumn('practice_records', 'question_order', 'question_order INTEGER')

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
  if (Number.isFinite(Number(filters?.examYear))) {
    sql += ' AND exam_year = ?'
    params.push(Number(filters.examYear))
  }
  if (filters?.examLevel) {
    sql += ' AND exam_level = ?'
    params.push(String(filters.examLevel))
  }
  const qualificationKeyword = String(filters?.qualificationKeyword || '').trim()
  if (qualificationKeyword) {
    sql += ' AND qualification_name LIKE ?'
    params.push(`%${qualificationKeyword}%`)
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
    source: String(question?.source || ''),
    examYear: Number.isFinite(Number(question?.examYear)) ? Number(question?.examYear) : null,
    examLevel: question?.examLevel ? String(question.examLevel) : null,
    qualificationName: question?.qualificationName ? String(question.qualificationName) : null
  }

  const stmt = db.prepare(`
    INSERT INTO questions (
      title, content, type, options, answer, analysis, images,
      category_id, difficulty, source, exam_year, exam_level, qualification_name
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    safeQuestion.source,
    safeQuestion.examYear,
    safeQuestion.examLevel,
    safeQuestion.qualificationName
  )

  return {
    id: Number(result.lastInsertRowid),
    ...safeQuestion
  }
})

ipcMain.handle('db:updateQuestion', (_, question) => {
  if (!db) return null

  const safeQuestion = {
    id: Number(question?.id),
    title: String(question?.title || ''),
    content: String(question?.content || ''),
    type: String(question?.type || 'single'),
    options: Array.isArray(question?.options) ? question.options.map((item: unknown) => String(item)) : [],
    answer: String(question?.answer || ''),
    analysis: String(question?.analysis || ''),
    images: Array.isArray(question?.images) ? question.images.map((item: unknown) => String(item)) : [],
    categoryId: Number.isFinite(Number(question?.categoryId)) ? Number(question?.categoryId) : undefined,
    difficulty: Number.isFinite(Number(question?.difficulty)) ? Number(question?.difficulty) : 1,
    source: String(question?.source || ''),
    examYear: Number.isFinite(Number(question?.examYear)) ? Number(question?.examYear) : null,
    examLevel: question?.examLevel ? String(question.examLevel) : null,
    qualificationName: question?.qualificationName ? String(question.qualificationName) : null
  }

  const stmt = db.prepare(`
    UPDATE questions SET
      title = ?, content = ?, type = ?, options = ?, answer = ?,
      analysis = ?, images = ?, category_id = ?, difficulty = ?, source = ?,
      exam_year = ?, exam_level = ?, qualification_name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
  stmt.run(
    safeQuestion.title,
    safeQuestion.content,
    safeQuestion.type,
    JSON.stringify(safeQuestion.options),
    safeQuestion.answer,
    safeQuestion.analysis,
    JSON.stringify(safeQuestion.images),
    safeQuestion.categoryId,
    safeQuestion.difficulty,
    safeQuestion.source,
    safeQuestion.examYear,
    safeQuestion.examLevel,
    safeQuestion.qualificationName,
    safeQuestion.id
  )

  return safeQuestion
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

ipcMain.handle('db:createPracticeSession', (_, session) => {
  if (!db) return null

  const safeSession = {
    examYear: Number.isFinite(Number(session?.examYear)) ? Number(session?.examYear) : null,
    examLevel: session?.examLevel ? String(session.examLevel) : null,
    qualificationName: session?.qualificationName ? String(session.qualificationName) : null,
    totalCount: Number.isFinite(Number(session?.totalCount)) ? Number(session.totalCount) : 0,
    correctCount: Number.isFinite(Number(session?.correctCount)) ? Number(session.correctCount) : 0,
    accuracy: Number.isFinite(Number(session?.accuracy)) ? Number(session.accuracy) : 0
  }

  const stmt = db.prepare(`
    INSERT INTO practice_sessions (
      exam_year, exam_level, qualification_name,
      total_count, correct_count, accuracy
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const result = stmt.run(
    safeSession.examYear,
    safeSession.examLevel,
    safeSession.qualificationName,
    safeSession.totalCount,
    safeSession.correctCount,
    safeSession.accuracy
  )

  return {
    id: Number(result.lastInsertRowid),
    ...safeSession
  }
})

ipcMain.handle('db:addPracticeRecords', (_, records) => {
  if (!db) return { inserted: 0 }
  if (!Array.isArray(records) || records.length === 0) return { inserted: 0 }

  type PracticeRecordPayload = {
    questionId?: unknown
    userAnswer?: unknown
    isCorrect?: unknown
    sessionId?: unknown
    questionOrder?: unknown
  }

  const normalized = (records as PracticeRecordPayload[]).map((item) => {
    const questionId = Number(item.questionId)
    const sessionId = Number(item.sessionId)
    if (!Number.isFinite(questionId) || !Number.isFinite(sessionId)) {
      throw new Error('练习记录参数不合法')
    }

    return {
      questionId,
      userAnswer: String(item.userAnswer || ''),
      isCorrect: item.isCorrect ? 1 : 0,
      sessionId,
      questionOrder: Number.isFinite(Number(item.questionOrder)) ? Number(item.questionOrder) : null
    }
  })

  const stmt = db.prepare(`
    INSERT INTO practice_records (
      question_id, user_answer, is_correct, session_id, question_order
    )
    VALUES (?, ?, ?, ?, ?)
  `)

  const transaction = db.transaction((items: Array<{ questionId: number; userAnswer: string; isCorrect: number; sessionId: number; questionOrder: number | null }>) => {
    for (const item of items) {
      stmt.run(item.questionId, item.userAnswer, item.isCorrect, item.sessionId, item.questionOrder)
    }
  })

  transaction(normalized)

  return { inserted: normalized.length }
})

ipcMain.handle('db:savePracticeResult', (_, payload) => {
  if (!db) throw new Error('数据库未初始化')

  type PracticeRecordDraftPayload = {
    questionId?: unknown
    userAnswer?: unknown
    isCorrect?: unknown
    questionOrder?: unknown
  }

  const records = Array.isArray(payload?.records) ? (payload.records as PracticeRecordDraftPayload[]) : []
  if (records.length === 0) {
    throw new Error('练习记录不能为空')
  }

  const safeSession = {
    examYear: Number.isFinite(Number(payload?.session?.examYear)) ? Number(payload.session.examYear) : null,
    examLevel: payload?.session?.examLevel ? String(payload.session.examLevel) : null,
    qualificationName: payload?.session?.qualificationName ? String(payload.session.qualificationName) : null,
    totalCount: Number.isFinite(Number(payload?.session?.totalCount)) ? Number(payload.session.totalCount) : records.length,
    correctCount: Number.isFinite(Number(payload?.session?.correctCount)) ? Number(payload.session.correctCount) : 0,
    accuracy: Number.isFinite(Number(payload?.session?.accuracy)) ? Number(payload.session.accuracy) : 0
  }

  const normalizedRecords = records.map((item, index) => {
    const questionId = Number(item.questionId)
    if (!Number.isFinite(questionId)) {
      throw new Error('练习记录参数不合法')
    }

    return {
      questionId,
      userAnswer: String(item.userAnswer || ''),
      isCorrect: item.isCorrect ? 1 : 0,
      questionOrder: Number.isFinite(Number(item.questionOrder)) ? Number(item.questionOrder) : index + 1
    }
  })

  const insertSessionStmt = db.prepare(`
    INSERT INTO practice_sessions (
      exam_year, exam_level, qualification_name,
      total_count, correct_count, accuracy
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertRecordStmt = db.prepare(`
    INSERT INTO practice_records (
      question_id, user_answer, is_correct, session_id, question_order
    )
    VALUES (?, ?, ?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    const sessionResult = insertSessionStmt.run(
      safeSession.examYear,
      safeSession.examLevel,
      safeSession.qualificationName,
      safeSession.totalCount,
      safeSession.correctCount,
      safeSession.accuracy
    )

    const sessionId = Number(sessionResult.lastInsertRowid)

    for (const record of normalizedRecords) {
      insertRecordStmt.run(
        record.questionId,
        record.userAnswer,
        record.isCorrect,
        sessionId,
        record.questionOrder
      )
    }

    return {
      session: {
        id: sessionId,
        ...safeSession
      },
      inserted: normalizedRecords.length
    }
  })

  return transaction()
})

ipcMain.handle('db:getPracticeSessions', (_, filters) => {
  if (!db) return []

  let sql = 'SELECT * FROM practice_sessions WHERE 1=1'
  const params: any[] = []

  if (Number.isFinite(Number(filters?.examYear))) {
    sql += ' AND exam_year = ?'
    params.push(Number(filters.examYear))
  }
  if (filters?.examLevel) {
    sql += ' AND exam_level = ?'
    params.push(String(filters.examLevel))
  }
  const qualificationKeyword = String(filters?.qualificationKeyword || '').trim()
  if (qualificationKeyword) {
    sql += ' AND qualification_name LIKE ?'
    params.push(`%${qualificationKeyword}%`)
  }

  sql += ' ORDER BY created_at DESC'

  return db.prepare(sql).all(...params)
})

ipcMain.handle('db:getPracticeSessionDetails', (_, sessionId: number) => {
  if (!db) return []
  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) return []

  return db.prepare(`
    SELECT
      pr.id,
      pr.session_id,
      pr.question_id,
      pr.question_order,
      pr.user_answer,
      pr.is_correct,
      pr.practiced_at,
      COALESCE(q.title, '[题目已删除]') AS title,
      q.content,
      q.type,
      q.options,
      q.answer,
      q.analysis,
      q.exam_year,
      q.exam_level,
      q.qualification_name
    FROM practice_records pr
    LEFT JOIN questions q ON q.id = pr.question_id
    WHERE pr.session_id = ?
    ORDER BY pr.question_order ASC, pr.id ASC
  `).all(safeSessionId)
})

// IPC处理 - 文件操作
ipcMain.handle('file:selectPdf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win!, {
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile']
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