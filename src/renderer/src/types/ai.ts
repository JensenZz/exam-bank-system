// AI 服务相关类型定义（从主进程类型复制）

/**
 * AI 服务提供商类型
 */
export type AiProvider = 'openai' | 'baidu' | 'aliyun' | 'custom'

/**
 * AI 服务配置接口
 */
export interface AiServiceConfig {
  /** 服务提供商 */
  provider: AiProvider
  /** API 密钥 */
  apiKey: string
  /** 模型名称 */
  model: string
  /** 自定义 API 端点（可选） */
  endpoint?: string
  /** 温度参数，控制创造性 (0-1) */
  temperature?: number
  /** 最大 token 数 */
  maxTokens?: number
  /** 自定义 prompt 模板（可选） */
  promptTemplate?: string
}

/**
 * 题目类型
 */
export type QuestionType = 'single' | 'multiple' | 'fill' | 'essay'

/**
 * 提取的题目数据
 */
export interface ExtractedQuestion {
  /** 题目标题 */
  title: string
  /** 题目内容/题干 */
  content?: string
  /** 题目类型 */
  type: QuestionType
  /** 选项（单选/多选时使用） */
  options?: string[]
  /** 正确答案 */
  answer: string
  /** 答案解析 */
  analysis?: string
  /** 分类名称（用于自动分类） */
  categoryName?: string
  /** 难度级别 (1-3) */
  difficulty?: number
  /** 题目来源 */
  source?: string
}

/**
 * 提取的分类数据
 */
export interface ExtractedCategory {
  /** 分类名称 */
  name: string
  /** 父分类 ID（可选） */
  parentId?: number
  /** 父分类名称（用于嵌套分类） */
  parentName?: string
}

/**
 * AI 解析结果
 */
export interface AiResult {
  /** 提取的分类列表 */
  categories: ExtractedCategory[]
  /** 提取的题目列表 */
  questions: ExtractedQuestion[]
}

/**
 * AI 服务错误类型
 */
export class AiServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'AiServiceError'
  }
}
