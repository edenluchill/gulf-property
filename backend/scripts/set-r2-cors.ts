/**
 * set-r2-cors — 给 R2 桶配 CORS(2026-07-14)。
 *
 *   npx ts-node scripts/set-r2-cors.ts
 *
 * 保留原有 PUT 规则(浏览器直传上传用),新增 GET 规则 —— 让前端能把 R2 上的图片
 * (经纪名片照片 agent-photos/*)画进 canvas 并 toDataURL 导出(入驻海报头像)。
 * R2 公共域默认不发 Access-Control-Allow-Origin,跨域 canvas 会污染 → 必须配 CORS。
 * 幂等:直接覆盖成「PUT + GET」两条,重复跑安全。
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '.env') })
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3'

const ORIGINS = ['https://pinzos.com', 'https://www.pinzos.com', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']

async function main() {
  const bucket = process.env.R2_BUCKET_NAME || 'gulf-property-images'
  const c = new S3Client({
    region: 'auto', endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
  })

  await c.send(new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        // 保留:浏览器直传上传(见 memory dubai-upload-direct-r2)
        { AllowedMethods: ['PUT'], AllowedOrigins: ORIGINS, AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 },
        // 新增:canvas 画 R2 图片(入驻海报头像用名片照片)
        { AllowedMethods: ['GET'], AllowedOrigins: ORIGINS, AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 86400 },
      ],
    },
  }))
  console.log('✓ CORS set on', bucket)
  const r = await c.send(new GetBucketCorsCommand({ Bucket: bucket }))
  console.log(JSON.stringify(r.CORSRules, null, 2))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
