import axios, { AxiosError } from 'axios'
import type {
  AiServiceConfig,
  AiResult,
  ExtractedQuestion,
  ExtractedCategory,
  AiProvider,
  AiServiceError
} from './types/ai.js'

/**
 * AI 服务统一接口类
 * 支持多个 AI 服务提供商：OpenAI、百度文心、阿里云等
 */
export class AiService {
  constructor(private config: AiServiceConfig) {}

  /**
   * 从文本中提取题目和分类
   * @param text PDF 提取的文本内容
   * @returns AI 解析结果
   */
  async extractQuestions(text: string): Promise<AiResult> {
    switch (this.config.provider) {
      case 'openai':
        return this.callOpenAI(text)
      case 'baidu':
        return this.callBaidu(text)
      case 'aliyun':
        return this.callAliyun(text)
      case 'custom':
        return this.callCustom(text)
      default:
        throw new Error(`不支持的 AI 服务提供商: ${this.config.provider}`)
    }
  }

  /**
   * 构建 AI prompt
   */
  private buildPrompt(text: string): string {
    const defaultTemplate = `请分析以下文本，提取所有题目并按照 JSON 格式返回：

文本内容：
${text}

请严格按照以下 JSON 格式返回结果：
{
  "categories": [
    {"name": "分类名", "parentName": "父分类名（可选）"}
  ],
  "questions": [
    {
      "title": "题目标题（必填）",
      "content": "题目内容/题干（可选）",
      "type": "题目类型：single(单选)|multiple(多选)|fill(填空)|essay(简答)",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "正确答案（必填）",
      "analysis": "答案解析（可选）",
      "categoryName": "所属分类名称（可选）",
      "difficulty": 1,
      "source": "题目来源（可选）"
    }
  ]
}

注意事项：
1. type 字段必须是以下之一：single(单选)、multiple(多选)、fill(填空)、essay(简答)
2. 单选题和多选题必须提供 options 数组
3. 分类如果不存在会自动创建
4. 如果没有明确分类，可以不设置 categoryName
5. 难度级别：1=简单，2=中等，3=困难，默认为1`

    return this.config.promptTemplate
      ? this.config.promptTemplate.replace('{{text}}', text)
      : defaultTemplate
  }

  /**
   * 解析 AI 响应内容
   */
  private parseResponse(content: string): AiResult {
    try {
      // 尝试提取 JSON 内容（AI 可能在 markdown 代码块中返回）
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                       content.match(/```\s*([\s\S]*?)\s*```/) ||
                       content.match(/(\{[\s\S]*\})/)

      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
      const result = JSON.parse(jsonStr.trim())

      // 验证结果结构
      if (!result.questions || !Array.isArray(result.questions)) {
        throw new Error('AI 响应缺少 questions 数组')
      }

      return {
        categories: result.categories || [],
        questions: result.questions.map((q: any) => this.normalizeQuestion(q))
      }
    } catch (error) {
      console.error('解析 AI 响应失败:', error)
      console.error('原始内容:', content)
      throw new Error(`解析 AI 响应失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 规范化题目数据
   */
  private normalizeQuestion(q: any): ExtractedQuestion {
    return {
      title: q.title || q.question || '未命名题目',
      content: q.content || q.stem || q.description,
      type: this.normalizeType(q.type),
      options: Array.isArray(q.options) ? q.options : undefined,
      answer: String(q.answer || q.correctAnswer || ''),
      analysis: q.analysis || q.explanation || q.parse,
      categoryName: q.categoryName || q.category || q.chapter,
      difficulty: Math.min(3, Math.max(1, parseInt(q.difficulty) || 1)),
      source: q.source
    }
  }

  /**
   * 规范化题目类型
   */
  private normalizeType(type: string): ExtractedQuestion['type'] {
    const typeMap: Record<string, ExtractedQuestion['type']> = {
      'single': 'single',
      'single_choice': 'single',
      '单选': 'single',
      '单选题': 'single',
      'multiple': 'multiple',
      'multi_choice': 'multiple',
      '多选': 'multiple',
      '多选题': 'multiple',
      'fill': 'fill',
      'fill_blank': 'fill',
      '填空': 'fill',
      '填空题': 'fill',
      'essay': 'essay',
      'short_answer': 'essay',
      '简答': 'essay',
      '简答题': 'essay'
    }
    return typeMap[type?.toLowerCase()] || 'essay'
  }

  /**
   * 调用 OpenAI API
   */
  private async callOpenAI(text: string): Promise<AiResult> {
    const endpoint = this.config.endpoint || 'https://api.openai.com/v1/chat/completions'
    const model = this.config.model || 'gpt-3.5-turbo'

    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [{ role: 'user', content: this.buildPrompt(text) }],
          temperature: this.config.temperature ?? 0.3,
          max_tokens: this.config.maxTokens ?? 4000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      )

      const content = response.data.choices[0].message.content
      return this.parseResponse(content)
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError
        if (axiosError.response?.status === 401) {
          throw new Error('API Key 无效，请检查配置')
        }
        if (axiosError.code === 'ECONNABORTED') {
          throw new Error('请求超时，请检查网络连接')
        }
        throw new Error(`OpenAI API 错误: ${axiosError.message}`)
      }
      throw error
    }
  }

  /**
   * 调用百度文心 API
   */
  private async callBaidu(text: string): Promise<AiResult> {
    // 百度文心 API 实现
    const endpoint = this.config.endpoint || 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions'
    const model = this.config.model || 'ernie-bot'

    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [{ role: 'user', content: this.buildPrompt(text) }],
          temperature: this.config.temperature ?? 0.3
        },
        {
          params: { access_token: this.config.apiKey },
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000
        }
      )

      const content = response.data.result
      return this.parseResponse(content)
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`百度文心 API 错误: ${error.message}`)
      }
      throw error
    }
  }

  /**
   * 调用阿里云灵积 API
   */
  private async callAliyun(text: string): Promise<AiResult> {
    const endpoint = this.config.endpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
    const model = this.config.model || 'qwen-turbo'

    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          input: { messages: [{ role: 'user', content: this.buildPrompt(text) }] },
          parameters: {
            temperature: this.config.temperature ?? 0.3,
            max_tokens: this.config.maxTokens ?? 4000
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      )

      const content = response.data.output.text
      return this.parseResponse(content)
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`阿里云 API 错误: ${error.message}`)
      }
      throw error
    }
  }

  /**
   * 调用自定义 API
   */
  private async callCustom(text: string): Promise<AiResult> {
    if (!this.config.endpoint) {
      throw new Error('自定义 API 必须设置 endpoint')
    }

    const endpoint = this.config.endpoint.endsWith('/chat/completions')
      ? this.config.endpoint
      : this.config.endpoint.replace(/\/$/, '') + '/chat/completions'

    try {
      const response = await axios.post(
        endpoint,
        {
          model: this.config.model,
          messages: [{ role: 'user', content: this.buildPrompt(text) }],
          temperature: this.config.temperature ?? 0.3,
          max_tokens: this.config.maxTokens ?? 2000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 180000
        }
      )

      // 尝试多种响应格式
      const content = response.data.choices?.[0]?.message?.content ||
                     response.data.result ||
                     response.data.output?.text ||
                     response.data.text ||
                     JSON.stringify(response.data)

      return this.parseResponse(content)
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError
        if (axiosError.code === 'ECONNABORTED') {
          throw new Error('自定义 API 请求超时（60秒），请减少单次文本长度或检查网络')
        }
        const upstreamMessage = (axiosError.response?.data as any)?.error?.message ||
          (axiosError.response?.data as any)?.message ||
          axiosError.message
        throw new Error(`自定义 API 错误: ${upstreamMessage}`)
      }
      throw error
    }
  }
}

export default AiService
