import { BrowserWindow, app, ipcMain, safeStorage, session as electronSession } from 'electron'
import type Database from 'better-sqlite3'
import axios from 'axios'
import { URL } from 'url'
import { AiService } from './aiService.js'
import { configManager } from './configManager.js'
import type { AiServiceConfig } from './types/ai.js'

type CrawlSiteType = 'auto' | '51cto' | 'generic'
type CrawlSessionStatus = 'idle' | 'ready' | 'manual' | 'expired'
type CrawlTaskStatus =
  | 'pending'
  | 'auth_required'
  | 'fetching'
  | 'extracting'
  | 'ai_parsing'
  | 'ready_for_preview'
  | 'importing'
  | 'completed'
  | 'failed'

type ParsedQuestionDraft = {
  title: string
  content?: string
  type: 'single' | 'multiple' | 'fill' | 'essay'
  options: string[]
  answer: string
  analysis?: string
  categoryName?: string
  difficulty?: number
  source?: string
  images?: string[]
  warnings?: string[]
}

type CrawlPreviewPayload = {
  sourceUrl: string
  siteType: CrawlSiteType
  htmlTitle?: string
  extractedText: string
  questions: ParsedQuestionDraft[]
}

type CrawlTaskRecord = {
  id: number
  siteType: CrawlSiteType
  url: string
  domain: string
  sessionRef?: string
  status: CrawlTaskStatus
  progressMessage?: string
  errorMessage?: string
  preview?: CrawlPreviewPayload
  createdAt: string
  updatedAt: string
}

type CrawlSessionRecord = {
  id: number
  domain: string
  siteType: CrawlSiteType
  status: CrawlSessionStatus
  loginUrl: string
  cookiePreview?: string
  createdAt: string
  updatedAt: string
}

type RuntimeTaskState = {
  status: CrawlTaskStatus
  progressMessage?: string
  preview?: CrawlPreviewPayload
  errorMessage?: string
}

type RenderedPageSnapshot = {
  html: string
  extractedText: string
  title: string
  images: string[]
}

const crawlTasks = new Map<number, RuntimeTaskState>()
const loginWindows = new Map<number, BrowserWindow>()
const runtimeCookies = new Map<number, string>()
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
const DEFAULT_HTTP_OPTIONS = {
  timeout: 30000,
  maxRedirects: 5,
  proxy: false as const
}

function nowIso(): string {
  return new Date().toISOString()
}

function parseDomain(inputUrl: string): string {
  return new URL(inputUrl).hostname
}

function normalizeSiteType(siteType: unknown, url: string): CrawlSiteType {
  const value = String(siteType || '').trim()
  if (value === '51cto' || value === 'generic' || value === 'auto') {
    return value
  }
  return /51cto\.com/i.test(url) ? '51cto' : 'auto'
}

function inferSiteType(siteType: CrawlSiteType, url: string): CrawlSiteType {
  if (siteType !== 'auto') return siteType
  return /51cto\.com/i.test(url) ? '51cto' : 'generic'
}

function normalizeQuestionType(value: unknown): ParsedQuestionDraft['type'] {
  const safe = String(value || '').trim().toLowerCase()
  if (safe === 'single' || safe === 'multiple' || safe === 'fill' || safe === 'essay') {
    return safe
  }
  if (['单选', '单选题', 'single_choice'].includes(safe)) return 'single'
  if (['多选', '多选题', 'multi_choice'].includes(safe)) return 'multiple'
  if (['填空', '填空题', 'fill_blank'].includes(safe)) return 'fill'
  return 'essay'
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.trim() || ''
}

function extractImageUrls(html: string, baseUrl: string): string[] {
  const matches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
  return matches
    .map((match) => match[1])
    .filter(Boolean)
    .map((src) => {
      try {
        return new URL(src, baseUrl).toString()
      } catch {
        return src
      }
    })
    .slice(0, 50)
}

function dedupeTextBlocks(blocks: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const block of blocks) {
    const normalized = block.replace(/\s+/g, ' ').trim()
    if (!normalized || normalized.length < 8 || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(block.trim())
  }
  return result
}

function shouldUseRenderedHtmlFallback(html: string): boolean {
  const normalized = html.toLowerCase()
  if (!normalized.trim()) return true
  return normalized.includes('__nuxt') ||
    normalized.includes('id="__nuxt"') ||
    normalized.includes('id="nuxt-app"') ||
    normalized.includes('_nuxt/') ||
    normalized.includes('window.__nuxt') ||
    normalized.includes('data-server-rendered') ||
    normalized.includes('hydration')
}

function parseCookiePairs(cookie: string): Array<{ name: string; value: string }> {
  return cookie
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const index = item.indexOf('=')
      if (index <= 0) {
        return null
      }
      return {
        name: item.slice(0, index).trim(),
        value: item.slice(index + 1).trim()
      }
    })
    .filter((item): item is { name: string; value: string } => Boolean(item?.name))
}

function detectAuthFailure(html: string, status?: number): boolean {
  const normalized = html.toLowerCase()
  return status === 401 ||
    status === 403 ||
    normalized.includes('登录后') ||
    normalized.includes('请登录') ||
    normalized.includes('立即登录') ||
    normalized.includes('扫码登录') ||
    normalized.includes('验证码') ||
    normalized.includes('sign in') ||
    normalized.includes('login')
}

function buildCookieHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

function maskCookie(cookie: string): string {
  if (!cookie) return ''
  if (cookie.length <= 12) return '***'
  return `${cookie.slice(0, 6)}...${cookie.slice(-6)}`
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function cleanText(value: unknown): string {
  return stripHtml(decodeHtmlEntities(String(value || ''))).replace(/\s{2,}/g, ' ').trim()
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => cleanText(item)).filter(Boolean)
}

function ensureFlexibleStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return ensureStringArray(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return ensureStringArray(parsed)
        }
      } catch {
        // fall through to plain string handling
      }
    }

    return [cleanText(trimmed)].filter(Boolean)
  }

  if (value == null) {
    return []
  }

  return [cleanText(value)].filter(Boolean)
}

function extract51ctoDetailPayload(response: any): { questions: any[]; title?: string } {
  const candidates = [
    response?.data?.data?.data,
    response?.data?.data,
    response?.data
  ].filter(Boolean)

  for (const candidate of candidates) {
    const directQuestions = Array.isArray(candidate?.question) ? candidate.question : null
    if (directQuestions?.length) {
      return {
        questions: directQuestions,
        title: cleanText(candidate?.examine?.title || candidate?.title)
      }
    }

    if (Array.isArray(candidate)) {
      return {
        questions: candidate,
        title: ''
      }
    }
  }

  return { questions: [], title: '' }
}

function parse51ctoUrl(targetUrl: string): { examMode?: number; recordId?: number } | null {
  try {
    const url = new URL(targetUrl)
    const answerMatch = url.pathname.match(/\/exam\/answer\/em-(\d+)\/(\d+)/i)
    if (answerMatch) {
      return {
        examMode: Number(answerMatch[1]),
        recordId: Number(answerMatch[2])
      }
    }

    const id = Number(url.searchParams.get('id') || url.searchParams.get('exam') || '')
    if (Number.isFinite(id) && id > 0) {
      return { recordId: id }
    }
  } catch {
    return null
  }

  return null
}

function normalize51ctoQuestionType(questionType: unknown, answerType: unknown): ParsedQuestionDraft['type'] {
  const type = Number(questionType)
  const answer = Number(answerType)
  if ([1, 9, 11, 3, 13].includes(type)) return 'single'
  if ([2, 7, 12].includes(type)) return 'multiple'
  if ([4, 8].includes(type)) return 'fill'
  if (type === 10) {
    if (answer === 1 || answer === 3) return 'single'
    if (answer === 2) return 'multiple'
    if (answer === 4) return 'fill'
  }
  return 'essay'
}

function build51ctoOptionLines(options: unknown): string[] {
  const values = ensureFlexibleStringArray(options)
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return values.map((item, index) => `${labels[index] || `${index + 1}`}. ${item}`)
}

function collectWarnings(question: ParsedQuestionDraft): string[] {
  const warnings = [...(question.warnings || [])]
  if (!question.answer) warnings.push('缺少答案')
  if ((question.type === 'single' || question.type === 'multiple') && question.options.length === 0) {
    warnings.push('选项缺失')
  }
  if (question.type === 'essay' && !question.analysis) {
    warnings.push('解析缺失')
  }
  return Array.from(new Set(warnings))
}

function build51ctoDraftFromListDetail(item: any, sourceUrl: string): ParsedQuestionDraft {
  const questionType = Number(item?.question_type || 0)
  const answerType = Number(item?.answer_type || 0)
  const type = normalize51ctoQuestionType(questionType, answerType)
  const materialText = cleanText(item?.material_text)
  const title = cleanText(item?.question_title)
  const content = [materialText, title].filter(Boolean).join('\n\n') || title
  const answerItems = ensureFlexibleStringArray(item?.answer)
  const answer = answerItems.join(type === 'multiple' ? ', ' : '\n')
  const warnings: string[] = []
  if (!type || type === 'essay' && !String(item?.show_type_name || '').trim()) {
    warnings.push('题型待确认')
  }

  const draft: ParsedQuestionDraft = {
    title: title || content || `第${Number(item?.index || 0)}题`,
    content: content || undefined,
    type,
    options: build51ctoOptionLines(item?.option),
    answer,
    analysis: cleanText(item?.analyze) || undefined,
    categoryName: cleanText(item?.show_type_name) || undefined,
    difficulty: Number.isFinite(Number(item?.score)) ? Number(item.score) : undefined,
    source: sourceUrl,
    images: [],
    warnings
  }

  draft.warnings = collectWarnings(draft)
  return draft
}

function build51ctoDraftFromExamQuestion(data: any, sourceUrl: string): ParsedQuestionDraft {
  const type = normalize51ctoQuestionType(data?.type, data?.type)
  const draft: ParsedQuestionDraft = {
    title: cleanText(data?.title) || `题目 ${String(data?.id || '')}`.trim(),
    content: cleanText(data?.title) || undefined,
    type,
    options: build51ctoOptionLines(data?.radio_option),
    answer: cleanText(data?.radio_answer),
    analysis: cleanText(data?.analyze) || undefined,
    categoryName: cleanText(data?.knowledge) || undefined,
    difficulty: Number.isFinite(Number(data?.difficulty)) ? Number(data.difficulty) : undefined,
    source: sourceUrl,
    images: [],
    warnings: []
  }

  draft.warnings = collectWarnings(draft)
  return draft
}

function build51ctoExtractedText(questions: ParsedQuestionDraft[]): string {
  return questions
    .map((question, index) => {
      const blocks = [
        `${index + 1}. ${question.title}`,
        question.content || '',
        question.options.join('\n'),
        question.answer ? `答案：${question.answer}` : '',
        question.analysis ? `解析：${question.analysis}` : ''
      ].filter(Boolean)
      return blocks.join('\n')
    })
    .join('\n\n')
}

async function fetchRenderedHtml(targetUrl: string, cookie: string, taskId: number): Promise<string> {
  const snapshot = await fetchRenderedSnapshot(targetUrl, cookie, taskId)
  return snapshot.html
}

async function fetchRenderedSnapshot(targetUrl: string, cookie: string, taskId: number): Promise<RenderedPageSnapshot> {
  const partition = `persist:crawl-render-${taskId}`
  const isolatedSession = electronSession.fromPartition(partition)
  const cookiePairs = parseCookiePairs(cookie)

  for (const pair of cookiePairs) {
    try {
      await isolatedSession.cookies.set({
        url: targetUrl,
        name: pair.name,
        value: pair.value,
        path: '/',
        secure: targetUrl.startsWith('https://')
      })
    } catch {
      // keep going; a subset of cookies is enough for many pages
    }
  }

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  try {
    await window.loadURL(targetUrl, {
      userAgent: DEFAULT_USER_AGENT
    })
    await new Promise((resolve) => setTimeout(resolve, 1800))
    const snapshot = await window.webContents.executeJavaScript(`
      (() => {
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
        const pickText = (elements) => Array.from(elements || [])
          .map((element) => normalize(element.innerText || element.textContent || ''))
          .filter(Boolean)

        const rootSelectors = [
          'main',
          'article',
          '.main',
          '.content',
          '.container',
          '.detail',
          '.paper',
          '.exam',
          '.test',
          '.question',
          '.questions',
          '.subject',
          '.topic'
        ]

        const questionSelectors = [
          '[class*="question"]',
          '[class*="subject"]',
          '[class*="topic"]',
          '[class*="stem"]',
          '[class*="title"]',
          '[class*="option"]',
          '[class*="answer"]',
          '[class*="analysis"]',
          '.ql-editor',
          '.rich-text',
          'label',
          'li'
        ]

        const textBlocks = []
        for (const selector of rootSelectors) {
          textBlocks.push(...pickText(document.querySelectorAll(selector)))
        }
        for (const selector of questionSelectors) {
          textBlocks.push(...pickText(document.querySelectorAll(selector)))
        }

        const fallbackText = normalize(document.body ? document.body.innerText || '' : '')
        if (fallbackText) {
          textBlocks.push(fallbackText)
        }

        const images = Array.from(document.images || [])
          .map((image) => image.currentSrc || image.src || '')
          .filter(Boolean)
          .slice(0, 50)

        return {
          html: document.documentElement ? document.documentElement.outerHTML : '',
          extractedText: textBlocks.join('\\n\\n'),
          title: document.title || '',
          images
        }
      })()
    `, true)

    return {
      html: String(snapshot?.html || ''),
      extractedText: dedupeTextBlocks(String(snapshot?.extractedText || '').split(/\n{2,}/)).join('\n\n'),
      title: String(snapshot?.title || ''),
      images: Array.isArray(snapshot?.images) ? snapshot.images.map((item: unknown) => String(item)).filter(Boolean) : []
    }
  } finally {
    if (!window.isDestroyed()) {
      window.destroy()
    }
    try {
      await isolatedSession.clearStorageData()
    } catch {
      // ignore cleanup failure
    }
  }
}

async function fetch51ctoPreview(targetUrl: string, cookie: string): Promise<CrawlPreviewPayload | null> {
  const parsed = parse51ctoUrl(targetUrl)
  if (!parsed?.recordId) {
    return null
  }

  const client = axios.create({
    baseURL: 'https://t.51cto.com',
    ...DEFAULT_HTTP_OPTIONS,
    headers: {
      Cookie: cookie || undefined,
      Referer: targetUrl,
      Origin: 'https://rk.51cto.com',
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json, text/plain, */*'
    }
  })

  try {
    const detailResponse = await client.get('/list/detail', {
      params: {
        id: parsed.recordId,
        needAnswer: 1
      }
    })

    const detailPayload = extract51ctoDetailPayload(detailResponse)
    const detailQuestions = detailPayload.questions.map((item: any) => build51ctoDraftFromListDetail(item, targetUrl))

    if (detailQuestions.length > 0) {
      return {
        sourceUrl: targetUrl,
        siteType: '51cto',
        htmlTitle: detailPayload.title || '51CTO 题目详情',
        extractedText: build51ctoExtractedText(detailQuestions),
        questions: detailQuestions
      }
    }
  } catch {
    // fall through to next 51CTO endpoint
  }

  try {
    const questionResponse = await client.get('/exam/get-question', {
      params: {
        id: parsed.recordId
      }
    })

    if (questionResponse.data?.data) {
      const question = build51ctoDraftFromExamQuestion(questionResponse.data.data, targetUrl)
      if (question.title || question.content) {
        return {
          sourceUrl: targetUrl,
          siteType: '51cto',
          htmlTitle: '51CTO 题目详情',
          extractedText: build51ctoExtractedText([question]),
          questions: [question]
        }
      }
    }
  } catch {
    return null
  }

  return null
}

function encryptCookie(cookie: string): Buffer | null {
  if (!cookie) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(cookie)
}

function decryptCookie(blob: Buffer | null): string {
  if (!blob || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(blob)
  } catch {
    return ''
  }
}

function createCookiePartition(sessionId: number): string {
  return `persist:crawl-session-${sessionId}`
}

function normalizeParsedQuestion(raw: any, fallbackSource: string, imagePool: string[]): ParsedQuestionDraft {
  const rawImages = Array.isArray(raw?.images) ? raw.images.map((item: unknown) => String(item)) : []
  const warnings = Array.isArray(raw?.warnings) ? raw.warnings.map((item: unknown) => String(item)) : []

  return {
    title: String(raw?.title || raw?.question || '').trim(),
    content: raw?.content ? String(raw.content) : undefined,
    type: normalizeQuestionType(raw?.type),
    options: Array.isArray(raw?.options) ? raw.options.map((item: unknown) => String(item)) : [],
    answer: String(raw?.answer || '').trim(),
    analysis: raw?.analysis ? String(raw.analysis) : undefined,
    categoryName: raw?.categoryName ? String(raw.categoryName) : undefined,
    difficulty: Number.isFinite(Number(raw?.difficulty)) ? Number(raw.difficulty) : undefined,
    source: String(raw?.source || fallbackSource || '').trim() || undefined,
    images: rawImages.length > 0 ? rawImages : imagePool.slice(0, 6),
    warnings
  }
}

function chunkText(text: string, maxChars = 9000): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const result: string[] = []
  let start = 0
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length)
    if (end < normalized.length) {
      const breakPos = normalized.lastIndexOf('\n', end)
      if (breakPos > start + 2000) {
        end = breakPos
      }
    }
    result.push(normalized.slice(start, end).trim())
    start = end
  }
  return result.filter(Boolean)
}

function summarizeHtml(siteType: CrawlSiteType, sourceUrl: string, html: string): { text: string; title: string; images: string[] } {
  const title = extractTitle(html)
  const images = extractImageUrls(html, sourceUrl)

  if (siteType === '51cto') {
    const questionBlocks = [...html.matchAll(/<div[^>]+class=["'][^"']*(?:question|item|topic)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map((match) => stripHtml(match[1]))
      .filter(Boolean)

    const answerBlocks = [...html.matchAll(/<div[^>]+class=["'][^"']*(?:answer|analysis)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map((match) => stripHtml(match[1]))
      .filter(Boolean)

    const merged = [...questionBlocks, ...answerBlocks].join('\n\n')
    if (merged.trim()) {
      return { text: merged, title, images }
    }
  }

  return {
    text: stripHtml(html),
    title,
    images
  }
}

async function loadAiConfig(fallback?: AiServiceConfig): Promise<AiServiceConfig> {
  if (fallback?.apiKey && fallback?.model) {
    return fallback
  }

  const savedConfig = await configManager.loadConfig()
  if (!savedConfig?.apiKey || !savedConfig?.model) {
    throw new Error('请先在设置中配置 AI 服务后再执行网页抓取')
  }

  return {
    provider: savedConfig.provider || 'openai',
    apiKey: savedConfig.apiKey,
    model: savedConfig.model,
    endpoint: savedConfig.endpoint,
    temperature: savedConfig.temperature,
    maxTokens: savedConfig.maxTokens,
    promptTemplate: savedConfig.promptTemplate
  } as AiServiceConfig
}

function buildPrompt(sourceUrl: string, title: string, chunk: string, siteType: CrawlSiteType, images: string[]): string {
  return [
    '请从下面的网页内容中提取考试题目，并输出严格 JSON。',
    '如果内容不是题目页，questions 返回空数组，并在 warnings 中写明原因。',
    '需要尽量识别题型：single, multiple, fill, essay。',
    '如果题型不明确，type 填 essay，并在 warnings 中标记“题型待确认”。',
    '如果缺少答案、选项或解析，也要保留题目，并在 warnings 中标记问题。',
    '',
    `来源站点：${siteType}`,
    `网页标题：${title || '未知'}`,
    `网页链接：${sourceUrl}`,
    images.length > 0 ? `页面图片：${images.slice(0, 10).join('\n')}` : '',
    '',
    '返回格式：',
    '{',
    '  "questions": [',
    '    {',
    '      "title": "题目标题或题干首句",',
    '      "content": "完整题干",',
    '      "type": "single|multiple|fill|essay",',
    '      "options": ["A.xxx", "B.xxx"],',
    '      "answer": "答案文本",',
    '      "analysis": "解析文本",',
    '      "categoryName": "分类（可选）",',
    '      "difficulty": 1,',
    '      "source": "来源描述",',
    '      "images": ["图片URL"],',
    '      "warnings": ["缺少答案"]',
    '    }',
    '  ]',
    '}',
    '',
    '网页正文：',
    chunk
  ].filter(Boolean).join('\n')
}

async function parseQuestionsWithAi(
  sourceUrl: string,
  siteType: CrawlSiteType,
  title: string,
  extractedText: string,
  images: string[],
  config?: AiServiceConfig
): Promise<ParsedQuestionDraft[]> {
  const aiConfig = await loadAiConfig(config)
  const service = new AiService({ ...aiConfig, promptTemplate: '{{text}}' })
  const chunks = chunkText(extractedText, 9000)
  const questions: ParsedQuestionDraft[] = []

  for (const chunk of chunks) {
    const result = await service.extractQuestions(buildPrompt(sourceUrl, title, chunk, siteType, images))
    for (const question of result.questions || []) {
      const normalized = normalizeParsedQuestion(question, sourceUrl, images)
      if (normalized.title || normalized.content) {
        questions.push(normalized)
      }
    }
  }

  return questions
}

function mapSessionRow(row: any): CrawlSessionRecord {
  return {
    id: Number(row?.id || 0),
    domain: String(row?.domain || ''),
    siteType: normalizeSiteType(row?.site_type, row?.login_url || ''),
    status: String(row?.status || 'idle') as CrawlSessionStatus,
    loginUrl: String(row?.login_url || ''),
    cookiePreview: row?.cookie_preview ? String(row.cookie_preview) : undefined,
    createdAt: row?.created_at ? String(row.created_at) : nowIso(),
    updatedAt: row?.updated_at ? String(row.updated_at) : nowIso()
  }
}

function mapTaskRow(row: any): CrawlTaskRecord {
  let preview: CrawlPreviewPayload | undefined
  if (row?.preview_json) {
    try {
      preview = JSON.parse(String(row.preview_json))
    } catch {
      preview = undefined
    }
  }

  const runtime = crawlTasks.get(Number(row?.id))

  return {
    id: Number(row?.id || 0),
    siteType: normalizeSiteType(row?.site_type, row?.url || ''),
    url: String(row?.url || ''),
    domain: String(row?.domain || ''),
    sessionRef: row?.session_ref ? String(row.session_ref) : undefined,
    status: (runtime?.status || String(row?.status || 'pending')) as CrawlTaskStatus,
    progressMessage: runtime?.progressMessage || (row?.progress_message ? String(row.progress_message) : undefined),
    errorMessage: runtime?.errorMessage || (row?.error_message ? String(row.error_message) : undefined),
    preview: runtime?.preview || preview,
    createdAt: row?.created_at ? String(row.created_at) : nowIso(),
    updatedAt: row?.updated_at ? String(row.updated_at) : nowIso()
  }
}

function updateTaskState(db: Database.Database, taskId: number, next: Partial<RuntimeTaskState>): CrawlTaskRecord {
  const current = crawlTasks.get(taskId) || { status: 'pending' as CrawlTaskStatus }
  const state: RuntimeTaskState = { ...current, ...next }
  crawlTasks.set(taskId, state)

  db.prepare(`
    UPDATE crawl_tasks
    SET status = ?, progress_message = ?, error_message = ?, preview_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    state.status,
    state.progressMessage || null,
    state.errorMessage || null,
    state.preview ? JSON.stringify(state.preview) : null,
    taskId
  )

  const row = db.prepare('SELECT * FROM crawl_tasks WHERE id = ?').get(taskId)
  return mapTaskRow(row)
}

async function fetchCookiesForDomain(sessionId: number, url: string): Promise<string> {
  const partition = createCookiePartition(sessionId)
  const partitionSession = electronSession.fromPartition(partition)
  const cookies = await partitionSession.cookies.get({ url })
  return buildCookieHeader(cookies)
}

async function persistCookie(db: Database.Database, sessionId: number, cookie: string, status: CrawlSessionStatus): Promise<CrawlSessionRecord> {
  const encrypted = encryptCookie(cookie)
  const cookiePreview = maskCookie(cookie)
  runtimeCookies.set(sessionId, cookie)
  db.prepare(`
    UPDATE crawl_sessions
    SET status = ?, cookie_encrypted = ?, cookie_preview = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, encrypted || null, cookiePreview || null, sessionId)

  const row = db.prepare('SELECT * FROM crawl_sessions WHERE id = ?').get(sessionId)
  return mapSessionRow(row)
}

function getCookieForSession(db: Database.Database, sessionRef?: string): string {
  const sessionId = Number(sessionRef)
  if (!Number.isFinite(sessionId)) {
    return ''
  }
  const runtimeCookie = runtimeCookies.get(sessionId)
  if (runtimeCookie) {
    return runtimeCookie
  }
  const row = db.prepare('SELECT cookie_encrypted FROM crawl_sessions WHERE id = ?').get(sessionId) as { cookie_encrypted?: Buffer | null } | undefined
  return decryptCookie(row?.cookie_encrypted || null)
}

async function validateCookie(url: string, cookie: string): Promise<boolean> {
  try {
    const response = await axios.get(url, {
      ...DEFAULT_HTTP_OPTIONS,
      headers: {
        Cookie: cookie,
        'User-Agent': DEFAULT_USER_AGENT
      }
    })
    return !detectAuthFailure(String(response.data || ''), response.status)
  } catch {
    return false
  }
}

async function startTask(
  db: Database.Database,
  taskId: number,
  siteType: CrawlSiteType,
  targetUrl: string,
  sessionRef: string | undefined,
  config?: AiServiceConfig
): Promise<void> {
  try {
    updateTaskState(db, taskId, { status: 'fetching', progressMessage: '正在抓取网页内容', errorMessage: undefined })

    const cookie = getCookieForSession(db, sessionRef)
    const actualSiteType = inferSiteType(siteType, targetUrl)
    let responseStatus: number | undefined

    if (actualSiteType === '51cto') {
      const apiPreview = await fetch51ctoPreview(targetUrl, cookie)
      if (apiPreview?.questions?.length) {
        updateTaskState(db, taskId, {
          status: 'ready_for_preview',
          progressMessage: `已通过 51CTO 接口识别 ${apiPreview.questions.length} 道题目，等待确认入库`,
          preview: apiPreview,
          errorMessage: undefined
        })
        return
      }
    }

    let html = ''
    let renderedText = ''
    let renderedTitle = ''
    let renderedImages: string[] = []

    try {
      const response = await axios.get(targetUrl, {
        ...DEFAULT_HTTP_OPTIONS,
        headers: {
          Cookie: cookie || undefined,
          'User-Agent': DEFAULT_USER_AGENT
        }
      })
      responseStatus = response.status
      html = String(response.data || '')
    } catch (requestError: any) {
      responseStatus = Number(requestError?.response?.status || 0) || undefined
      if (responseStatus && responseStatus < 500 && responseStatus !== 408) {
        throw requestError
      }
    }

    if (!html.trim() || shouldUseRenderedHtmlFallback(html) || /cheko\.cc/i.test(targetUrl)) {
      try {
        const renderedSnapshot = await fetchRenderedSnapshot(targetUrl, cookie, taskId)
        if (renderedSnapshot.html.trim()) {
          html = renderedSnapshot.html
        }
        renderedText = renderedSnapshot.extractedText
        renderedTitle = renderedSnapshot.title
        renderedImages = renderedSnapshot.images
      } catch (renderError: any) {
        if (!html.trim()) {
          throw renderError
        }
      }
    }

    if (!html.trim()) {
      throw new Error(responseStatus ? `网页抓取失败，状态码 ${responseStatus}` : '网页内容为空，无法解析题目')
    }

    if (detectAuthFailure(html, responseStatus)) {
      updateTaskState(db, taskId, {
        status: 'auth_required',
        progressMessage: '检测到登录态失效，请重新登录后再抓取',
        errorMessage: '认证失效或页面跳转到了登录页'
      })
      return
    }

    updateTaskState(db, taskId, { status: 'extracting', progressMessage: '正在抽取网页正文和题目块' })

    const summary = summarizeHtml(actualSiteType, targetUrl, html)
    if (renderedText.trim().length > summary.text.trim().length / 2) {
      summary.text = dedupeTextBlocks([renderedText, summary.text]).join('\n\n')
    }
    if (renderedTitle.trim()) {
      summary.title = renderedTitle
    }
    if (renderedImages.length > 0) {
      summary.images = Array.from(new Set([...renderedImages, ...summary.images])).slice(0, 50)
    }
    if (!summary.text.trim()) {
      throw new Error('未能从网页中提取到有效正文')
    }

    updateTaskState(db, taskId, { status: 'ai_parsing', progressMessage: '正在调用 AI 解析题目结构' })

    const questions = await parseQuestionsWithAi(targetUrl, actualSiteType, summary.title, summary.text, summary.images, config)

    if (questions.length === 0) {
      throw new Error('AI 未识别到可导入题目，请确认链接是否为题目详情页或解析页')
    }

    const preview: CrawlPreviewPayload = {
      sourceUrl: targetUrl,
      siteType: actualSiteType,
      htmlTitle: summary.title,
      extractedText: summary.text,
      questions
    }

    updateTaskState(db, taskId, {
      status: 'ready_for_preview',
      progressMessage: `已识别 ${questions.length} 道题目，等待确认入库`,
      preview,
      errorMessage: undefined
    })
  } catch (error: any) {
    updateTaskState(db, taskId, {
      status: 'failed',
      progressMessage: '网页抓取失败',
      errorMessage: String(error?.message || '网页抓取失败')
    })
  }
}

export function initializeCrawlDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      site_type TEXT NOT NULL DEFAULT 'auto',
      login_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      cookie_encrypted BLOB,
      cookie_preview TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_type TEXT NOT NULL DEFAULT 'auto',
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      session_ref TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_message TEXT,
      error_message TEXT,
      preview_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export function registerCrawlService(getDb: () => Database.Database | null, getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('crawl:getSessionByUrl', (_, targetUrl: string) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')

    const domain = parseDomain(targetUrl)
    const row = db.prepare('SELECT * FROM crawl_sessions WHERE domain = ?').get(domain)
    return row ? mapSessionRow(row) : null
  })

  ipcMain.handle('crawl:openLoginWindow', async (_, payload: { url: string; siteType?: CrawlSiteType }) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')

    const targetUrl = String(payload?.url || '').trim()
    if (!targetUrl) throw new Error('登录链接不能为空')

    const domain = parseDomain(targetUrl)
    const siteType = normalizeSiteType(payload?.siteType, targetUrl)
    const existing = db.prepare('SELECT * FROM crawl_sessions WHERE domain = ?').get(domain) as any

    let sessionId = Number(existing?.id || 0)
    if (!sessionId) {
      const inserted = db.prepare(`
        INSERT INTO crawl_sessions (domain, site_type, login_url, status)
        VALUES (?, ?, ?, 'idle')
      `).run(domain, siteType, targetUrl)
      sessionId = Number(inserted.lastInsertRowid)
    } else {
      db.prepare(`
        UPDATE crawl_sessions
        SET site_type = ?, login_url = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(siteType, targetUrl, sessionId)
    }

    const partition = createCookiePartition(sessionId)
    const loginWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      title: `网页登录 - ${domain}`,
      autoHideMenuBar: true,
      closable: true,
      minimizable: false,
      maximizable: false,
      parent: getMainWindow() || undefined,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    })

    loginWindows.set(sessionId, loginWindow)
    let isClosingWindow = false

    const requestCloseWindow = () => {
      if (isClosingWindow || loginWindow.isDestroyed()) {
        return
      }
      isClosingWindow = true
      loginWindows.delete(sessionId)
      loginWindow.destroy()
    }

    const persistCurrentCookies = async (autoClose = false) => {
      const cookie = await fetchCookiesForDomain(sessionId, targetUrl)
      if (cookie) {
        const isValid = await validateCookie(targetUrl, cookie)
        await persistCookie(db, sessionId, cookie, isValid ? 'ready' : 'idle')
        if (autoClose && isValid) {
          requestCloseWindow()
        }
      }
    }

    loginWindow.webContents.on('did-finish-load', () => {
      void persistCurrentCookies(true)
    })
    loginWindow.webContents.on('did-navigate', () => {
      void persistCurrentCookies(true)
    })
    loginWindow.webContents.on('did-stop-loading', () => {
      void persistCurrentCookies(true)
    })
    loginWindow.on('close', (event) => {
      if (isClosingWindow) {
        return
      }
      event.preventDefault()
      isClosingWindow = true
      loginWindows.delete(sessionId)
      setImmediate(() => {
        if (!loginWindow.isDestroyed()) {
          loginWindow.destroy()
        }
      })
    })
    loginWindow.on('closed', () => {
      loginWindows.delete(sessionId)
      void persistCurrentCookies(false)
    })

    await loginWindow.loadURL(targetUrl)

    const row = db.prepare('SELECT * FROM crawl_sessions WHERE id = ?').get(sessionId)
    return mapSessionRow(row)
  })

  ipcMain.handle('crawl:saveManualCookie', async (_, payload: { url: string; siteType?: CrawlSiteType; cookie: string }) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')

    const targetUrl = String(payload?.url || '').trim()
    const cookie = String(payload?.cookie || '').trim()
    if (!targetUrl || !cookie) {
      throw new Error('链接和 Cookie 均不能为空')
    }

    const domain = parseDomain(targetUrl)
    const siteType = normalizeSiteType(payload?.siteType, targetUrl)
    const existing = db.prepare('SELECT * FROM crawl_sessions WHERE domain = ?').get(domain) as any
    let sessionId = Number(existing?.id || 0)
    if (!sessionId) {
      const inserted = db.prepare(`
        INSERT INTO crawl_sessions (domain, site_type, login_url, status)
        VALUES (?, ?, ?, 'idle')
      `).run(domain, siteType, targetUrl)
      sessionId = Number(inserted.lastInsertRowid)
    } else {
      db.prepare('UPDATE crawl_sessions SET login_url = ?, site_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetUrl, siteType, sessionId)
    }

    const isValid = await validateCookie(targetUrl, cookie)
    const record = await persistCookie(db, sessionId, cookie, isValid ? 'manual' : 'expired')
    if (!isValid) {
      throw new Error('Cookie 已保存，但验证失败，请确认 Cookie 是否可访问该题目页')
    }
    return record
  })

  ipcMain.handle('crawl:createTask', async (_, payload: { url: string; siteType?: CrawlSiteType; sessionRef?: string; aiConfig?: AiServiceConfig }) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')

    const targetUrl = String(payload?.url || '').trim()
    if (!targetUrl) throw new Error('抓取链接不能为空')

    const domain = parseDomain(targetUrl)
    const siteType = normalizeSiteType(payload?.siteType, targetUrl)
    const sessionRef = payload?.sessionRef ? String(payload.sessionRef) : undefined

    const inserted = db.prepare(`
      INSERT INTO crawl_tasks (site_type, url, domain, session_ref, status, progress_message)
      VALUES (?, ?, ?, ?, 'pending', '任务已创建')
    `).run(siteType, targetUrl, domain, sessionRef || null)

    const taskId = Number(inserted.lastInsertRowid)
    crawlTasks.set(taskId, { status: 'pending', progressMessage: '任务已创建' })
    void startTask(db, taskId, siteType, targetUrl, sessionRef, payload?.aiConfig)

    const row = db.prepare('SELECT * FROM crawl_tasks WHERE id = ?').get(taskId)
    return mapTaskRow(row)
  })

  ipcMain.handle('crawl:getTask', (_, taskId: number) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')

    const row = db.prepare('SELECT * FROM crawl_tasks WHERE id = ?').get(Number(taskId))
    if (!row) {
      throw new Error('抓取任务不存在')
    }
    return mapTaskRow(row)
  })

  ipcMain.handle('crawl:markTaskImporting', (_, taskId: number) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')
    return updateTaskState(db, Number(taskId), {
      status: 'importing',
      progressMessage: '正在写入题库'
    })
  })

  ipcMain.handle('crawl:completeTask', (_, taskId: number, summary?: { importedCount?: number }) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')
    const importedCount = Number(summary?.importedCount || 0)
    return updateTaskState(db, Number(taskId), {
      status: 'completed',
      progressMessage: `已完成入库，共 ${importedCount} 道题目`,
      errorMessage: undefined
    })
  })

  ipcMain.handle('crawl:failTask', (_, taskId: number, errorMessage?: string) => {
    const db = getDb()
    if (!db) throw new Error('数据库未初始化')
    return updateTaskState(db, Number(taskId), {
      status: 'failed',
      progressMessage: '入库失败',
      errorMessage: String(errorMessage || '入库失败')
    })
  })

  app.on('before-quit', () => {
    loginWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.close()
      }
    })
    loginWindows.clear()
    crawlTasks.clear()
    runtimeCookies.clear()
  })
}



