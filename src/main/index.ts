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

type ImportSessionStatus =
  | 'created'
  | 'ocr_processing'
  | 'ocr_completed'
  | 'ai_processing'
  | 'preview_ready'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'canceled'

type ImportChunkStatus = 'pending' | 'processing' | 'success' | 'failed'

type ImportChunkSummary = {
  total: number
  success: number
  failed: number
  previewQuestionCount: number
}

const IMPORT_SESSION_STATUSES: ImportSessionStatus[] = [
  'created',
  'ocr_processing',
  'ocr_completed',
  'ai_processing',
  'preview_ready',
  'importing',
  'completed',
  'failed',
  'canceled'
]

const IMPORT_CHUNK_STATUSES: ImportChunkStatus[] = ['pending', 'processing', 'success', 'failed']

function normalizeImportSessionStatus(value: unknown, fallback: ImportSessionStatus = 'created'): ImportSessionStatus {
  const safeValue = String(value || '').trim() as ImportSessionStatus
  return IMPORT_SESSION_STATUSES.includes(safeValue) ? safeValue : fallback
}

function normalizeImportChunkStatus(value: unknown, fallback: ImportChunkStatus = 'pending'): ImportChunkStatus {
  const safeValue = String(value || '').trim() as ImportChunkStatus
  return IMPORT_CHUNK_STATUSES.includes(safeValue) ? safeValue : fallback
}

function getImportSessionById(sessionId: number) {
  if (!db) return null
  return db.prepare('SELECT * FROM import_sessions WHERE id = ?').get(sessionId)
}

function parseQuestionCountFromJson(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) {
    return 0
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function getImportChunkSummary(sessionId: number): ImportChunkSummary {
  if (!db) {
    return { total: 0, success: 0, failed: 0, previewQuestionCount: 0 }
  }

  const rows = db
    .prepare(`
      SELECT status, questions_json
      FROM import_session_chunks
      WHERE session_id = ?
    `)
    .all(sessionId) as Array<{ status: string; questions_json: string | null }>

  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 1
      if (row.status === 'success') {
        acc.success += 1
        acc.previewQuestionCount += parseQuestionCountFromJson(row.questions_json)
      }
      if (row.status === 'failed') {
        acc.failed += 1
      }
      return acc
    },
    { total: 0, success: 0, failed: 0, previewQuestionCount: 0 }
  )

  return summary
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

  // 创建 AI 导入会话表
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      exam_year INTEGER,
      exam_level TEXT,
      qualification_name TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      ocr_text TEXT,
      ocr_text_length INTEGER DEFAULT 0,
      ocr_total_pages INTEGER DEFAULT 0,
      chunk_total INTEGER DEFAULT 0,
      chunk_success INTEGER DEFAULT 0,
      chunk_failed INTEGER DEFAULT 0,
      preview_question_count INTEGER DEFAULT 0,
      imported_question_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `)

  // 创建 AI 导入分片表
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_session_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      questions_json TEXT,
      categories_json TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      UNIQUE(session_id, chunk_index)
    )
  `)

  db.exec('CREATE INDEX IF NOT EXISTS idx_import_sessions_status_created_at ON import_sessions(status, created_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_sessions_created_at ON import_sessions(created_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_session_chunks_session_status ON import_session_chunks(session_id, status)')

  // 增量迁移（幂等）
  ensureColumn('questions', 'exam_year', 'exam_year INTEGER')
  ensureColumn('questions', 'exam_level', 'exam_level TEXT')
  ensureColumn('questions', 'qualification_name', 'qualification_name TEXT')

  ensureColumn('practice_records', 'session_id', 'session_id INTEGER')
  ensureColumn('practice_records', 'question_order', 'question_order INTEGER')

  ensureColumn('import_sessions', 'file_name', 'file_name TEXT')
  ensureColumn('import_sessions', 'exam_year', 'exam_year INTEGER')
  ensureColumn('import_sessions', 'exam_level', 'exam_level TEXT')
  ensureColumn('import_sessions', 'qualification_name', 'qualification_name TEXT')
  ensureColumn('import_sessions', 'status', "status TEXT NOT NULL DEFAULT 'created'")
  ensureColumn('import_sessions', 'ocr_text', 'ocr_text TEXT')
  ensureColumn('import_sessions', 'ocr_text_length', 'ocr_text_length INTEGER DEFAULT 0')
  ensureColumn('import_sessions', 'ocr_total_pages', 'ocr_total_pages INTEGER DEFAULT 0')
  ensureColumn('import_sessions', 'chunk_total', 'chunk_total INTEGER DEFAULT 0')
  ensureColumn('import_sessions', 'chunk_success', 'chunk_success INTEGER DEFAULT 0')
  ensureColumn('import_sessions', 'chunk_failed', 'chunk_failed INTEGER DEFAULT 0')
  ensureColumn('import_sessions', 'preview_question_count', 'preview_question_count INTEGER DEFAULT 0')
  ensureColumn('import_sessions', 'imported_question_count', 'imported_question_count INTEGER DEFAULT 0')
  ensureColumn('import_sessions', 'last_error', 'last_error TEXT')
  ensureColumn('import_sessions', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP')
  ensureColumn('import_sessions', 'completed_at', 'completed_at DATETIME')

  ensureColumn('import_session_chunks', 'chunk_text', 'chunk_text TEXT')
  ensureColumn('import_session_chunks', 'status', "status TEXT NOT NULL DEFAULT 'pending'")
  ensureColumn('import_session_chunks', 'attempt_count', 'attempt_count INTEGER NOT NULL DEFAULT 0')
  ensureColumn('import_session_chunks', 'questions_json', 'questions_json TEXT')
  ensureColumn('import_session_chunks', 'categories_json', 'categories_json TEXT')
  ensureColumn('import_session_chunks', 'error_message', 'error_message TEXT')
  ensureColumn('import_session_chunks', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP')
  ensureColumn('import_session_chunks', 'completed_at', 'completed_at DATETIME')

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

ipcMain.handle('db:createImportSession', (_, payload) => {
  if (!db) throw new Error('数据库未初始化')

  const filePath = String(payload?.filePath || '').trim()
  if (!filePath) {
    throw new Error('文件路径不能为空')
  }

  const fileName = String(payload?.fileName || path.basename(filePath) || '').trim()
  if (!fileName) {
    throw new Error('文件名不能为空')
  }

  const examYear = Number.isFinite(Number(payload?.examYear)) ? Number(payload.examYear) : null
  const examLevel = payload?.examLevel ? String(payload.examLevel).trim() : null
  const qualificationName = payload?.qualificationName ? String(payload.qualificationName).trim() : null

  const stmt = db.prepare(`
    INSERT INTO import_sessions (
      file_path,
      file_name,
      exam_year,
      exam_level,
      qualification_name,
      status,
      last_error
    )
    VALUES (?, ?, ?, ?, ?, 'created', NULL)
  `)

  const result = stmt.run(filePath, fileName, examYear, examLevel, qualificationName)
  const sessionId = Number(result.lastInsertRowid)
  return getImportSessionById(sessionId)
})

ipcMain.handle('db:updateImportSessionMetadata', (_, sessionId: number, metadata) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) {
    throw new Error('会话 ID 不合法')
  }

  const existing = getImportSessionById(safeSessionId) as {
    file_path: string
    file_name: string
    exam_year: number | null
    exam_level: string | null
    qualification_name: string | null
  } | null

  if (!existing) {
    throw new Error('导入会话不存在')
  }

  const hasFilePath = Object.prototype.hasOwnProperty.call(metadata || {}, 'filePath')
  const hasFileName = Object.prototype.hasOwnProperty.call(metadata || {}, 'fileName')
  const hasExamYear = Object.prototype.hasOwnProperty.call(metadata || {}, 'examYear')
  const hasExamLevel = Object.prototype.hasOwnProperty.call(metadata || {}, 'examLevel')
  const hasQualificationName = Object.prototype.hasOwnProperty.call(metadata || {}, 'qualificationName')

  const filePath = hasFilePath ? String(metadata?.filePath || '').trim() || null : existing.file_path
  const fileName = hasFileName ? String(metadata?.fileName || '').trim() || null : existing.file_name
  const examYear = hasExamYear
    ? (Number.isFinite(Number(metadata?.examYear)) ? Number(metadata.examYear) : null)
    : existing.exam_year
  const examLevel = hasExamLevel ? (metadata?.examLevel ? String(metadata.examLevel).trim() : null) : existing.exam_level
  const qualificationName = hasQualificationName
    ? (metadata?.qualificationName ? String(metadata.qualificationName).trim() : null)
    : existing.qualification_name

  db.prepare(`
    UPDATE import_sessions
    SET
      file_path = COALESCE(?, file_path),
      file_name = COALESCE(?, file_name),
      exam_year = ?,
      exam_level = ?,
      qualification_name = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(filePath, fileName, examYear, examLevel, qualificationName, safeSessionId)

  return getImportSessionById(safeSessionId)
})

ipcMain.handle('db:saveImportOcrResult', (_, sessionId: number, payload) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) {
    throw new Error('会话 ID 不合法')
  }

  const session = getImportSessionById(safeSessionId)
  if (!session) {
    throw new Error('导入会话不存在')
  }

  const ocrText = String(payload?.ocrText || payload?.text || '')
  const ocrTextLength = Number.isFinite(Number(payload?.ocrTextLength))
    ? Number(payload.ocrTextLength)
    : ocrText.length
  const ocrTotalPages = Number.isFinite(Number(payload?.ocrTotalPages)) ? Number(payload.ocrTotalPages) : 0

  db.prepare(`
    UPDATE import_sessions
    SET
      ocr_text = ?,
      ocr_text_length = ?,
      ocr_total_pages = ?,
      status = 'ocr_completed',
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(ocrText, ocrTextLength, ocrTotalPages, safeSessionId)

  return getImportSessionById(safeSessionId)
})

ipcMain.handle('db:upsertImportChunks', (_, sessionId: number, chunks) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) {
    throw new Error('会话 ID 不合法')
  }

  const session = getImportSessionById(safeSessionId)
  if (!session) {
    throw new Error('导入会话不存在')
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('分片数据不能为空')
  }

  const uniqueChunkIndexes = new Set<number>()

  const normalizedChunks = chunks.map((chunk) => {
    const chunkIndex = Number(chunk?.chunkIndex)
    const chunkText = String(chunk?.chunkText || '').trim()
    if (!Number.isFinite(chunkIndex) || chunkIndex < 1 || !chunkText) {
      throw new Error('分片参数不合法')
    }

    if (uniqueChunkIndexes.has(chunkIndex)) {
      throw new Error(`分片序号重复: ${chunkIndex}`)
    }
    uniqueChunkIndexes.add(chunkIndex)

    return {
      chunkIndex,
      chunkText,
      status: normalizeImportChunkStatus(chunk?.status, 'pending')
    }
  })

  const upsertStmt = db.prepare(`
    INSERT INTO import_session_chunks (
      session_id,
      chunk_index,
      chunk_text,
      status
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, chunk_index)
    DO UPDATE SET
      chunk_text = excluded.chunk_text,
      updated_at = CURRENT_TIMESTAMP,
      status = CASE
        WHEN import_session_chunks.status = 'processing' THEN 'pending'
        ELSE import_session_chunks.status
      END
  `)

  const transaction = db.transaction((items: Array<{ chunkIndex: number; chunkText: string; status: ImportChunkStatus }>) => {
    for (const item of items) {
      upsertStmt.run(safeSessionId, item.chunkIndex, item.chunkText, item.status)
    }

    const summary = getImportChunkSummary(safeSessionId)

    db!.prepare(`
      UPDATE import_sessions
      SET
        chunk_total = ?,
        chunk_success = ?,
        chunk_failed = ?,
        preview_question_count = ?,
        status = 'ai_processing',
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary.total, summary.success, summary.failed, summary.previewQuestionCount, safeSessionId)

    return summary
  })

  const summary = transaction(normalizedChunks)

  return {
    session: getImportSessionById(safeSessionId),
    ...summary
  }
})

ipcMain.handle('db:saveImportChunkResult', (_, sessionId: number, chunkIndex: number, payload) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  const safeChunkIndex = Number(chunkIndex)
  if (!Number.isFinite(safeSessionId) || !Number.isFinite(safeChunkIndex) || safeChunkIndex < 1) {
    throw new Error('分片结果参数不合法')
  }

  const session = getImportSessionById(safeSessionId)
  if (!session) {
    throw new Error('导入会话不存在')
  }

  const status = normalizeImportChunkStatus(payload?.status, 'failed')
  const questionsJson = payload?.questions ? JSON.stringify(payload.questions) : null
  const categoriesJson = payload?.categories ? JSON.stringify(payload.categories) : null
  const errorMessage = payload?.errorMessage ? String(payload.errorMessage) : null

  const chunkExists = db
    .prepare('SELECT id FROM import_session_chunks WHERE session_id = ? AND chunk_index = ?')
    .get(safeSessionId, safeChunkIndex)

  if (!chunkExists) {
    throw new Error('导入分片不存在，请先创建分片')
  }

  const transaction = db.transaction(() => {
    db!.prepare(`
      UPDATE import_session_chunks
      SET
        status = ?,
        attempt_count = attempt_count + CASE WHEN ? IN ('success', 'failed') THEN 1 ELSE 0 END,
        questions_json = ?,
        categories_json = ?,
        error_message = ?,
        completed_at = CASE WHEN ? IN ('success', 'failed') THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ? AND chunk_index = ?
    `).run(status, status, questionsJson, categoriesJson, errorMessage, status, safeSessionId, safeChunkIndex)

    const countsRows = db!
      .prepare(`
        SELECT status, COUNT(1) AS count
        FROM import_session_chunks
        WHERE session_id = ?
        GROUP BY status
      `)
      .all(safeSessionId) as Array<{ status: string; count: number }>

    const counts = countsRows.reduce(
      (acc, row) => {
        const key = normalizeImportChunkStatus(row.status)
        acc[key] += Number(row.count || 0)
        return acc
      },
      { pending: 0, processing: 0, success: 0, failed: 0 }
    )

    const summary = getImportChunkSummary(safeSessionId)

    let nextStatus: ImportSessionStatus = 'ai_processing'
    if (summary.total > 0 && summary.success === summary.total) {
      nextStatus = 'preview_ready'
    } else if (counts.failed > 0 && counts.pending === 0 && counts.processing === 0) {
      nextStatus = 'failed'
    }

    const resolvedLastError = nextStatus === 'preview_ready'
      ? null
      : status === 'failed'
        ? (errorMessage || 'AI 分片解析失败')
        : String(session.last_error || '') || null

    db!.prepare(`
      UPDATE import_sessions
      SET
        chunk_total = ?,
        chunk_success = ?,
        chunk_failed = ?,
        preview_question_count = ?,
        status = ?,
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      summary.total,
      summary.success,
      summary.failed,
      summary.previewQuestionCount,
      nextStatus,
      resolvedLastError,
      safeSessionId
    )
  })

  transaction()

  return {
    session: getImportSessionById(safeSessionId),
    chunk: db
      .prepare('SELECT * FROM import_session_chunks WHERE session_id = ? AND chunk_index = ?')
      .get(safeSessionId, safeChunkIndex)
  }
})

ipcMain.handle('db:listImportSessions', (_, filters) => {
  if (!db) return []

  let sql = 'SELECT * FROM import_sessions WHERE 1=1'
  const params: Array<string | number> = []

  const status = String(filters?.status || '').trim()
  if (status && IMPORT_SESSION_STATUSES.includes(status as ImportSessionStatus)) {
    sql += ' AND status = ?'
    params.push(status)
  }

  if (filters?.excludeCompleted) {
    sql += " AND status <> 'completed'"
  }

  sql += ' ORDER BY created_at DESC'

  const safeLimit = Number(filters?.limit)
  if (Number.isFinite(safeLimit) && safeLimit > 0) {
    sql += ' LIMIT ?'
    params.push(Math.min(safeLimit, 200))
  }

  return db.prepare(sql).all(...params)
})

ipcMain.handle('db:getImportSessionDetails', (_, sessionId: number) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) {
    throw new Error('会话 ID 不合法')
  }

  const session = getImportSessionById(safeSessionId)
  if (!session) {
    throw new Error('导入会话不存在')
  }

  const chunks = db
    .prepare(`
      SELECT *
      FROM import_session_chunks
      WHERE session_id = ?
      ORDER BY chunk_index ASC
    `)
    .all(safeSessionId)

  return {
    session,
    chunks
  }
})

ipcMain.handle('db:getImportResumeContext', (_, sessionId: number) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) {
    throw new Error('会话 ID 不合法')
  }

  const session = getImportSessionById(safeSessionId)
  if (!session) {
    throw new Error('导入会话不存在')
  }

  const chunks = db
    .prepare(`
      SELECT *
      FROM import_session_chunks
      WHERE session_id = ?
      ORDER BY chunk_index ASC
    `)
    .all(safeSessionId) as Array<{
      id: number
      session_id: number
      chunk_index: number
      chunk_text: string
      status: string
      attempt_count: number
      questions_json: string | null
      categories_json: string | null
      error_message: string | null
      created_at: string
      updated_at: string
      completed_at: string | null
    }>

  const parsedSuccess = chunks.reduce(
    (acc, chunk) => {
      if (chunk.status !== 'success') {
        return acc
      }

      if (chunk.questions_json) {
        try {
          const parsed = JSON.parse(chunk.questions_json)
          if (Array.isArray(parsed)) {
            acc.questions.push(...parsed)
          }
        } catch {
          // ignore
        }
      }

      if (chunk.categories_json) {
        try {
          const parsed = JSON.parse(chunk.categories_json)
          if (Array.isArray(parsed)) {
            acc.categories.push(...parsed)
          }
        } catch {
          // ignore
        }
      }

      return acc
    },
    { questions: [] as unknown[], categories: [] as unknown[] }
  )

  return {
    session,
    chunks,
    resumableChunks: chunks.filter((chunk) => chunk.status === 'pending' || chunk.status === 'failed'),
    aggregatedPreview: parsedSuccess
  }
})

ipcMain.handle('db:markImportSessionStatus', (_, sessionId: number, status: ImportSessionStatus, errorMessage?: string) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) {
    throw new Error('会话 ID 不合法')
  }

  const session = getImportSessionById(safeSessionId)
  if (!session) {
    throw new Error('导入会话不存在')
  }

  const safeStatus = normalizeImportSessionStatus(status, 'created')
  const safeErrorMessage = errorMessage ? String(errorMessage) : null

  db.prepare(`
    UPDATE import_sessions
    SET
      status = ?,
      last_error = ?,
      completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(safeStatus, safeErrorMessage, safeStatus, safeSessionId)

  return getImportSessionById(safeSessionId)
})

ipcMain.handle('db:completeImportSession', (_, sessionId: number, summary) => {
  if (!db) throw new Error('数据库未初始化')

  const safeSessionId = Number(sessionId)
  if (!Number.isFinite(safeSessionId)) {
    throw new Error('会话 ID 不合法')
  }

  const session = getImportSessionById(safeSessionId)
  if (!session) {
    throw new Error('导入会话不存在')
  }

  const importedQuestionCount = Number.isFinite(Number(summary?.importedQuestionCount))
    ? Math.max(0, Number(summary.importedQuestionCount))
    : 0
  const previewQuestionCount = Number.isFinite(Number(summary?.previewQuestionCount))
    ? Math.max(0, Number(summary.previewQuestionCount))
    : Math.max(0, Number(session.preview_question_count || 0))

  const chunkSummary = getImportChunkSummary(safeSessionId)

  db.prepare(`
    UPDATE import_sessions
    SET
      status = 'completed',
      chunk_total = ?,
      chunk_success = ?,
      chunk_failed = ?,
      imported_question_count = ?,
      preview_question_count = ?,
      last_error = NULL,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    chunkSummary.total,
    chunkSummary.success,
    chunkSummary.failed,
    importedQuestionCount,
    previewQuestionCount,
    safeSessionId
  )

  return getImportSessionById(safeSessionId)
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

// AI 解题
ipcMain.handle('ai:solveQuestion', async (_, payload: any) => {
  try {
    const { configManager } = await import('./configManager.js')
    const savedConfig = await configManager.loadConfig()

    const provider = String(savedConfig?.provider || 'openai')
    const apiKey = String(savedConfig?.apiKey || '')
    const model = String(savedConfig?.model || '')
    const endpoint = String(savedConfig?.endpoint || '')
    const temperature = Number(savedConfig?.temperature)
    const maxTokens = Number(savedConfig?.maxTokens)

    if (!apiKey || !model) {
      throw new Error('请先在设置中配置 AI 提供商、API Key 和模型名称')
    }

    const title = String(payload?.title || '').trim()
    const content = String(payload?.content || '').trim()
    const type = String(payload?.type || '').trim()
    const options = Array.isArray(payload?.options) ? payload.options.map((item: unknown) => String(item || '')) : []

    const optionsText = options.length > 0
      ? options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n')
      : '（无选项）'

    const prompt = [
      '你是一名严谨的考试辅导老师。请解答下面题目。',
      '请按以下结构输出：',
      '1) 题目理解',
      '2) 解题步骤',
      '3) 最终答案',
      '4) 关键考点',
      '',
      `题型：${type || '未知'}`,
      `题目：${title}`,
      content ? `题干补充：${content}` : '',
      '选项：',
      optionsText
    ]
      .filter(Boolean)
      .join('\n')

    const resolvedTemperature = Number.isFinite(temperature) ? temperature : 0.3
    const resolvedMaxTokens = Number.isFinite(maxTokens) ? maxTokens : 2000

    if (provider === 'aliyun') {
      const resolvedEndpoint = endpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
      const response = await axios.post(
        resolvedEndpoint,
        {
          model,
          input: { messages: [{ role: 'user', content: prompt }] },
          parameters: {
            temperature: resolvedTemperature,
            max_tokens: resolvedMaxTokens
          }
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      )

      const contentText = String(response?.data?.output?.text || '').trim()
      if (!contentText) {
        throw new Error('AI 未返回有效解答内容')
      }
      return { content: contentText }
    }

    if (provider === 'baidu') {
      const resolvedEndpoint = endpoint || 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions'
      const response = await axios.post(
        resolvedEndpoint,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: resolvedTemperature
        },
        {
          params: { access_token: apiKey },
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000
        }
      )

      const contentText = String(response?.data?.result || '').trim()
      if (!contentText) {
        throw new Error('AI 未返回有效解答内容')
      }
      return { content: contentText }
    }

    const resolvedEndpoint = (() => {
      if (provider === 'custom') {
        if (!endpoint) {
          throw new Error('自定义提供商请先配置 API 端点')
        }
        return endpoint.endsWith('/chat/completions')
          ? endpoint
          : endpoint.replace(/\/$/, '') + '/chat/completions'
      }
      return endpoint || 'https://api.openai.com/v1/chat/completions'
    })()

    const response = await axios.post(
      resolvedEndpoint,
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: resolvedTemperature,
        max_tokens: resolvedMaxTokens
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    )

    const contentText = String(
      response?.data?.choices?.[0]?.message?.content ||
        response?.data?.result ||
        response?.data?.output?.text ||
        response?.data?.text ||
        ''
    ).trim()

    if (!contentText) {
      throw new Error('AI 未返回有效解答内容')
    }

    return { content: contentText }
  } catch (error: any) {
    const message =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'AI 解题失败'
    throw new Error(String(message))
  }
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
app
  .whenReady()
  .then(() => {
    electronApp.setAppUserModelId('com.exam-bank-system')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    try {
      initDatabase()
    } catch (error) {
      console.error('数据库初始化失败:', error)
      dialog.showErrorBox(
        '应用启动失败',
        '数据库依赖加载失败（better-sqlite3）。请在项目根目录执行 npm run postinstall 后重试。'
      )
      app.quit()
      return
    }

    createWindow()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    console.error('应用启动失败:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close()
    app.quit()
  }
})