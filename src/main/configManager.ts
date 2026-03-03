import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { AiServiceConfig } from './types/ai.js'

const CONFIG_FILE = 'ai-config.json'

/**
 * 配置管理器
 * 负责 AI 服务配置的持久化存储
 */
export class ConfigManager {
  private get configPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE)
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): Partial<AiServiceConfig> {
    return {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      temperature: 0.3,
      maxTokens: 4000
    }
  }

  /**
   * 加载配置
   * @returns AI 服务配置
   */
  async loadConfig(): Promise<Partial<AiServiceConfig>> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      const config = JSON.parse(data)
      return { ...this.getDefaultConfig(), ...config }
    } catch (error) {
      // 文件不存在或解析失败，返回默认配置
      return this.getDefaultConfig()
    }
  }

  /**
   * 保存配置
   * @param config AI 服务配置
   */
  async saveConfig(config: AiServiceConfig): Promise<void> {
    // 确保目录存在
    const dir = path.dirname(this.configPath)
    try {
      await fs.access(dir)
    } catch {
      await fs.mkdir(dir, { recursive: true })
    }

    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2))
  }

  /**
   * 清除配置
   */
  async clearConfig(): Promise<void> {
    try {
      await fs.unlink(this.configPath)
    } catch {
      // 文件不存在，忽略错误
    }
  }
}

// 导出单例实例
export const configManager = new ConfigManager()
