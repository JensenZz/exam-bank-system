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
    updateQuestion: (question: Question) => Promise<void>
    deleteQuestion: (id: number) => Promise<boolean>
    getCategories: () => Promise<Category[]>
    addCategory: (name: string, parentId?: number) => Promise<Category>
  }
  file: {
    selectPdf: () => Promise<string[]>
    readPdf: (filePath: string) => Promise<string>
    extractPdfText: (filePath: string) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>
    onExtractPdfTextProgress: (callback: (payload: { filePath: string; stage: 'text' | 'ocr'; page?: number; totalPages?: number; message: string }) => void) => () => void
  }
  ai: {
    extractQuestions: (text: string, config: AiServiceConfig) => Promise<AiResult>
  }
  config: {
    load: () => Promise<Partial<AiServiceConfig>>
    save: (config: AiServiceConfig) => Promise<void>
    test: (config: AiServiceConfig) => Promise<{ success: boolean; status?: number | null; message?: string }>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
}

export interface QuestionFilters {
  categoryId?: number
  type?: string
  keyword?: string
  limit?: number
}

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
}

export interface Question extends QuestionInput {
  id: number
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: number
  name: string
  parentId: number
  sortOrder: number
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
