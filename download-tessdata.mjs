import https from 'https'
import fs from 'fs'
import zlib from 'zlib'
import { mkdirSync } from 'fs'

mkdirSync('tessdata', { recursive: true })

function downloadRaw(url, dest, redirects = 0) {
  if (redirects > 10) return Promise.reject(new Error('too many redirects'))
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } }, res => {
      console.log('  status:', res.statusCode, url.slice(0, 80))
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume()
        return downloadRaw(res.headers.location, dest, redirects + 1).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('HTTP ' + res.statusCode))
      }
      const out = fs.createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => { out.close(); resolve() })
      out.on('error', reject)
    }).on('error', reject)
  })
}

const langs = [
  { name: 'chi_sim', url: 'https://huggingface.co/datasets/tesseract-ocr/tessdata/resolve/main/chi_sim.traineddata' },
  { name: 'eng',     url: 'https://huggingface.co/datasets/tesseract-ocr/tessdata/resolve/main/eng.traineddata' },
]

for (const { name, url } of langs) {
  const dest = `tessdata/${name}.traineddata`
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log(name, '已存在，跳过')
    continue
  }
  console.log('下载:', name, url)
  try {
    // 直接下载非 gz 版本，不需要 gunzip
    await downloadRaw(url, dest)
    console.log(name, '完成, 大小:', fs.statSync(dest).size)
  } catch (e) {
    console.error(name, '失败:', e.message)
  }
}
