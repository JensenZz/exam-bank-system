// TypeScript类型声明文件

export type AiProvider = 'openai' | 'baidu' | 'aliyun' | 'custom'

export interface AiServiceConfig {
  provider: AiProvider
  apiKey: string
  model: string
  endpoint?: string
  temperature?: number
  maxTokens?: number
  promptTemplate?: string
}

export interface ExtractedQuestion {
  title: string
  content?: string
  type: 'single' | 'multiple' | 'fill' | 'essay'
  options?: string[]
  answer: string
  analysis?: string
  categoryName?: string
  difficulty?: number
  source?: string
  images?: string[]
  warnings?: string[]
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
}

export interface ExtractedCategory {
  name: string
  parentId?: number
  parentName?: string
}

export interface AiResult {
  categories: ExtractedCategory[]
  questions: ExtractedQuestion[]
}

export interface ElectronAPI {
  db: {
    getQuestions: (filters?: QuestionFilters) => Promise<Question[]>
    addQuestion: (question: QuestionInput) => Promise<Question>
    updateQuestion: (question: QuestionInput & { id: number }) => Promise<Question>
    deleteQuestion: (id: number) => Promise<boolean>
    getCategories: () => Promise<Category[]>
    addCategory: (name: string, parentId?: number) => Promise<Category>
    createPracticeSession: (session: PracticeSessionInput) => Promise<PracticeSession>
    addPracticeRecords: (records: PracticeRecordInput[]) => Promise<{ inserted: number }>
    getPracticeSessions: (filters?: Pick<QuestionFilters, 'examYear' | 'examLevel' | 'qualificationKeyword'>) => Promise<PracticeSession[]>
    getPracticeSessionDetails: (sessionId: number) => Promise<PracticeRecordDetail[]>
    savePracticeResult: (payload: SavePracticeResultInput) => Promise<SavePracticeResultOutput>
    createImportSession: (payload: CreateImportSessionInput) => Promise<ImportSession>
    updateImportSessionMetadata: (sessionId: number, metadata: UpdateImportSessionMetadataInput) => Promise<ImportSession>
    saveImportOcrResult: (sessionId: number, payload: SaveImportOcrResultInput) => Promise<ImportSession>
    upsertImportChunks: (sessionId: number, chunks: ImportChunkInput[]) => Promise<ImportChunkUpsertResult>
    saveImportChunkResult: (sessionId: number, chunkIndex: number, payload: SaveImportChunkResultInput) => Promise<SaveImportChunkResultOutput>
    listImportSessions: (filters?: ImportSessionFilters) => Promise<ImportSession[]>
    getImportSessionDetails: (sessionId: number) => Promise<ImportSessionDetails>
    getImportResumeContext: (sessionId: number) => Promise<ImportResumeContext>
    markImportSessionStatus: (sessionId: number, status: ImportSessionStatus, errorMessage?: string) => Promise<ImportSession>
    completeImportSession: (sessionId: number, summary: CompleteImportSessionInput) => Promise<ImportSession>
  }
  file: {
    selectPdf: () => Promise<string[]>
    readPdf: (filePath: string) => Promise<string>
    extractPdfText: (filePath: string) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>
    onExtractPdfTextProgress: (callback: (payload: { filePath: string; stage: 'text' | 'ocr'; page?: number; totalPages?: number; message: string }) => void) => () => void
  }
  ai: {
    extractQuestions: (text: string, config: AiServiceConfig) => Promise<AiResult>
    solveQuestion: (payload: {
      title: string
      content?: string
      type: 'single' | 'multiple' | 'fill' | 'essay'
      options?: string[]
    }) => Promise<{ content: string }>
  }
  crawl: {
    getSessionByUrl: (url: string) => Promise<CrawlSession | null>
    openLoginWindow: (payload: { url: string; siteType?: CrawlSiteType }) => Promise<CrawlSession | null>
    saveManualCookie: (payload: { url: string; siteType?: CrawlSiteType; cookie: string }) => Promise<CrawlSession>
    createTask: (payload: { url: string; siteType?: CrawlSiteType; sessionRef?: string; aiConfig?: AiServiceConfig }) => Promise<CrawlTask>
    getTask: (taskId: number) => Promise<CrawlTask>
    markTaskImporting: (taskId: number) => Promise<CrawlTask>
    completeTask: (taskId: number, summary?: { importedCount?: number }) => Promise<CrawlTask>
    failTask: (taskId: number, errorMessage?: string) => Promise<CrawlTask>
  }
  config: {
    load: () => Promise<Partial<AiServiceConfig>>
    save: (config: AiServiceConfig) => Promise<void>
    test: (config: AiServiceConfig) => Promise<{ success: boolean; status?: number | null; message?: string }>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<boolean>
    close: () => Promise<void>
  }
  platform: NodeJS.Platform
}

export interface QuestionFilters {
  categoryId?: number
  type?: string
  keyword?: string
  examYear?: number
  examLevel?: ExamLevel
  qualificationKeyword?: string
  limit?: number
}

export type ExamLevel = '初级' | '中级' | '高级'

export interface QuestionInput {
  title: string
  content?: string
  type: 'single' | 'multiple' | 'fill' | 'essay'
  options?: string[]
  answer: string
  analysis?: string
  images?: string[]
  categoryId?: number
  difficulty?: number
  source?: string
  images?: string[]
  warnings?: string[]
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
}

export interface Question extends QuestionInput {
  id?: number
  createdAt?: string
  updatedAt?: string
}

export interface Category {
  id: number
  name: string
  parentId: number
  sortOrder: number
}

export interface PracticeSessionInput {
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
  totalCount: number
  correctCount: number
  accuracy: number
}

export interface PracticeSession extends PracticeSessionInput {
  id: number
  createdAt?: string
}

export interface PracticeRecordInput {
  questionId: number
  userAnswer: string
  isCorrect: boolean
  sessionId?: number
  questionOrder: number
}

export interface PracticeRecordDraftInput {
  questionId: number
  userAnswer: string
  isCorrect: boolean
  questionOrder: number
}

export interface SavePracticeResultInput {
  session: PracticeSessionInput
  records: PracticeRecordDraftInput[]
}

export interface SavePracticeResultOutput {
  session: PracticeSession
  inserted: number
}

export interface PracticeRecordDetail {
  id: number
  sessionId: number
  questionId: number
  questionOrder: number
  userAnswer: string
  isCorrect: number
  practicedAt: string
  title: string
  content?: string
  type: 'single' | 'multiple' | 'fill' | 'essay'
  options?: string[]
  answer: string
  analysis?: string
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
}

export type ImportSessionStatus =
  | 'created'
  | 'ocr_processing'
  | 'ocr_completed'
  | 'ai_processing'
  | 'preview_ready'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'canceled'

export type ImportChunkStatus = 'pending' | 'processing' | 'success' | 'failed'

export interface CreateImportSessionInput {
  filePath: string
  fileName?: string
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
}

export interface UpdateImportSessionMetadataInput {
  filePath?: string
  fileName?: string
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
}

export interface SaveImportOcrResultInput {
  ocrText: string
  ocrTextLength?: number
  ocrTotalPages?: number
}

export interface ImportChunkInput {
  chunkIndex: number
  chunkText: string
  status?: ImportChunkStatus
}

export interface SaveImportChunkResultInput {
  status: ImportChunkStatus
  questions?: ExtractedQuestion[]
  categories?: ExtractedCategory[]
  errorMessage?: string
}

export interface CompleteImportSessionInput {
  importedQuestionCount: number
  previewQuestionCount?: number
}

export interface ImportSession {
  id: number
  filePath: string
  fileName: string
  examYear?: number
  examLevel?: ExamLevel
  qualificationName?: string
  status: ImportSessionStatus
  ocrText?: string
  ocrTextLength: number
  ocrTotalPages: number
  chunkTotal: number
  chunkSuccess: number
  chunkFailed: number
  previewQuestionCount: number
  importedQuestionCount: number
  lastError?: string
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

export interface ImportSessionChunk {
  id: number
  sessionId: number
  chunkIndex: number
  chunkText: string
  status: ImportChunkStatus
  attemptCount: number
  questionsJson?: string
  categoriesJson?: string
  errorMessage?: string
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

export interface ImportChunkUpsertResult {
  session: ImportSession
  total: number
  success: number
  failed: number
  previewQuestionCount: number
}

export interface SaveImportChunkResultOutput {
  session: ImportSession
  chunk: ImportSessionChunk
}

export interface ImportSessionDetails {
  session: ImportSession
  chunks: ImportSessionChunk[]
}

export interface ImportResumeContext {
  session: ImportSession
  chunks: ImportSessionChunk[]
  resumableChunks: ImportSessionChunk[]
  aggregatedPreview: {
    questions: ExtractedQuestion[]
    categories: ExtractedCategory[]
  }
}

export interface ImportSessionFilters {
  status?: ImportSessionStatus
  excludeCompleted?: boolean
  limit?: number
}


export type CrawlSiteType = 'auto' | '51cto' | 'generic'

export type CrawlSessionStatus = 'idle' | 'ready' | 'manual' | 'expired'

export type CrawlTaskStatus =
  | 'pending'
  | 'auth_required'
  | 'fetching'
  | 'extracting'
  | 'ai_parsing'
  | 'ready_for_preview'
  | 'importing'
  | 'completed'
  | 'failed'

export interface ParsedQuestionDraft extends ExtractedQuestion {
  images?: string[]
  warnings?: string[]
}

export interface CrawlSession {
  id: number
  domain: string
  siteType: CrawlSiteType
  status: CrawlSessionStatus
  loginUrl: string
  cookiePreview?: string
  createdAt?: string
  updatedAt?: string
}

export interface CrawlPreview {
  sourceUrl: string
  siteType: CrawlSiteType
  htmlTitle?: string
  extractedText: string
  questions: ParsedQuestionDraft[]
}

export interface CrawlTask {
  id: number
  siteType: CrawlSiteType
  url: string
  domain: string
  sessionRef?: string
  status: CrawlTaskStatus
  progressMessage?: string
  errorMessage?: string
  preview?: CrawlPreview
  createdAt?: string
  updatedAt?: string
}
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}


