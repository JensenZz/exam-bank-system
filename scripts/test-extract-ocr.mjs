import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const root = process.cwd()
const mainOutDir = path.resolve(root, 'out/main')
const pdfPath = path.resolve(root, '2505系统架构设计师真题回忆.pdf')

const chunk = fs
  .readdirSync(mainOutDir)
  .find((name) => name.startsWith('pdfProcessor-') && name.endsWith('.js'))

if (!chunk) {
  throw new Error('未找到 out/main/pdfProcessor-*.js，请先执行 npm run build')
}

if (!fs.existsSync(pdfPath)) {
  throw new Error(`PDF 文件不存在: ${pdfPath}`)
}

const moduleUrl = pathToFileURL(path.join(mainOutDir, chunk)).href
const mod = await import(moduleUrl)

if (typeof mod.extractPdfText !== 'function') {
  throw new Error('extractPdfText 未导出')
}

console.log('开始提取:', pdfPath)
console.log('模块:', chunk)
const start = Date.now()

const result = await mod.extractPdfText(pdfPath)

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
const text = result?.text ?? ''
const normalizedLength = text.replace(/\s+/g, '').length

console.log('耗时(秒):', elapsed)
console.log('页数:', result?.numpages)
console.log('文本总长度:', text.length)
console.log('去空白后长度:', normalizedLength)
console.log('info:', JSON.stringify(result?.info ?? {}))
console.log('预览:', text.slice(0, 500))
