import pdfParse from 'pdf-parse'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { createCanvas } from '@napi-rs/canvas'
import { createWorker } from 'tesseract.js'

export interface PdfExtractResult {
  text: string
  numpages: number
  info: Record<string, unknown>
}

const MIN_TEXT_CHAR_COUNT = 120
const OCR_SCALE = 2

function normalizeTextLength(text: string): number {
  return text.replace(/\s+/g, '').length
}

function isTextUsable(text: string): boolean {
  return normalizeTextLength(text) >= MIN_TEXT_CHAR_COUNT
}

function resolveTessdataPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules', '@tesseract.js-data', 'chi_sim', '4.0.0_best_int'),
    path.resolve(process.cwd(), 'resources', 'tessdata')
  ]

  const target = candidates.find((dir) => {
    const chi = path.join(dir, 'chi_sim.traineddata.gz')
    return existsSync(chi)
  })

  if (!target) {
    throw new Error('未找到 OCR 语言包，请安装 @tesseract.js-data/chi_sim（建议同时安装 @tesseract.js-data/eng）')
  }

  return target
}

function resolvePdfWorkerSrc(): string {
  const workerPath = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  if (!existsSync(workerPath)) {
    throw new Error('未找到 pdfjs worker 文件，请检查 pdfjs-dist 安装是否完整')
  }
  return pathToFileURL(workerPath).href
}

function resolvePdfWasmUrl(): string {
  const wasmDir = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/wasm')
  if (!existsSync(wasmDir)) {
    throw new Error('未找到 pdfjs wasm 目录，请检查 pdfjs-dist 安装是否完整')
  }
  // pdfjs 的 NodeWasmFactory 在 Node 环境下会直接把 baseUrl 当作文件路径传给 fs.readFile。
  // 因此这里必须返回本地目录路径（非 file:// URL），并保证有尾部斜杠。
  const normalized = wasmDir.replace(/\\/g, '/')
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

async function renderPageToPngBuffer(pdfPage: any): Promise<Buffer> {
  const viewport = pdfPage.getViewport({ scale: OCR_SCALE })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, viewport.width, viewport.height)

  await pdfPage.render({ canvasContext: context as any, viewport }).promise
  return canvas.toBuffer('image/png')
}

/**
 * 从 PDF 文件中提取文本内容
 * 先走文本层提取；若文本不足，则自动回退到 OCR
 */
export async function extractPdfText(
  filePath: string,
  onProgress?: (payload: { filePath: string; stage: 'text' | 'ocr'; page?: number; totalPages?: number; message: string }) => void
): Promise<PdfExtractResult> {
  onProgress?.({ filePath, stage: 'text', message: '正在提取 PDF 文本层…' })

  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)

  if (isTextUsable(data.text || '')) {
    onProgress?.({ filePath, stage: 'text', message: '文本层提取完成' })
    return {
      text: data.text,
      numpages: data.numpages,
      info: data.info
    }
  }

  onProgress?.({ filePath, stage: 'ocr', message: '检测到图片型 PDF，开始 OCR…' })

  const tessdataPath = resolveTessdataPath()
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc()

  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    wasmUrl: resolvePdfWasmUrl()
  }).promise

  const worker = await createWorker('chi_sim', 1, {
    langPath: tessdataPath,
    gzip: true,
    cacheMethod: 'none'
  })

  const textChunks: string[] = []
  try {
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      onProgress?.({
        filePath,
        stage: 'ocr',
        page: pageNum,
        totalPages: pdfDoc.numPages,
        message: `正在 OCR 第 ${pageNum}/${pdfDoc.numPages} 页…`
      })
      const page = await pdfDoc.getPage(pageNum)
      const imageBuffer = await renderPageToPngBuffer(page)
      const result = await worker.recognize(imageBuffer)
      textChunks.push(result.data.text || '')
    }
  } finally {
    await worker.terminate()
  }

  onProgress?.({ filePath, stage: 'ocr', page: pdfDoc.numPages, totalPages: pdfDoc.numPages, message: 'OCR 完成' })

  return {
    text: textChunks.join('\n'),
    numpages: pdfDoc.numPages,
    info: {
      ...(data.info || {}),
      extractionMethod: 'ocr_fallback'
    }
  }
}

/**
 * 批量提取多个 PDF 文件的文本
 * @param filePaths PDF 文件路径数组
 * @returns 提取结果数组
 */
export async function extractMultiplePdfs(filePaths: string[]): Promise<Array<PdfExtractResult & { filePath: string }>> {
  const results = await Promise.all(
    filePaths.map(async (filePath) => {
      const result = await extractPdfText(filePath)
      return {
        ...result,
        filePath
      }
    })
  )
  return results
}
