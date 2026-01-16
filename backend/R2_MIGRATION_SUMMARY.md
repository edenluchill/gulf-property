# R2 Storage Migration Summary

## ✅ What Changed

### Files Modified

1. **`src/services/r2-storage.ts`** (NEW)
   - Complete R2 storage service
   - Upload images to temp folder: `temp/{jobId}/images/`
   - Move images to permanent: `projects/{projectId}/images/`
   - Cleanup old temp files (24h+)
   - Test connection helper

2. **`src/langgraph/processors/simple-image-extractor.ts`**
   - Modified to upload images to R2 during PDF processing
   - Falls back to local storage if R2 fails
   - Returns R2 URLs instead of local paths

3. **`src/langgraph/processors/chunk-processor.ts`**
   - Added `jobId` parameter to config
   - Passes `jobId` to image extractor for R2 uploads

4. **`src/langgraph/processors/batch-processor.ts`**
   - Passes `jobId` through to chunk processor

5. **`src/routes/residential-projects.ts`**
   - Added R2 image migration on project submit
   - Moves project images from temp to permanent
   - Moves floor plan images from temp to permanent
   - Moves individual unit floor plan images

6. **`env.template`**
   - Added R2 configuration variables:
     - `R2_ENDPOINT`
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY`
     - `R2_BUCKET_NAME`
     - `R2_PUBLIC_URL`

7. **`package.json`**
   - Added cleanup script: `npm run cleanup-r2`

### Files Created

1. **`cleanup-r2-temp-files.ts`**
   - Automated cleanup script for old temp files
   - Deletes files older than 24 hours
   - Tests R2 connection before cleanup

2. **`cleanup-r2-temp-files.ps1`**
   - PowerShell wrapper for cleanup script
   - Easy to run on Windows

3. **`CLOUDFLARE_R2_SETUP.md`**
   - Complete setup guide
   - Step-by-step R2 configuration
   - Troubleshooting tips
   - Cost estimates

## 🔄 Migration Flow

### Before (Local Storage)
```
PDF Upload → Extract Images → Save to /uploads/langgraph-output/{jobId}/
                            ↓
                    Serve via /api/langgraph-images/:jobId/:filename
                            ↓
                    Submit → Keep same local paths in DB
                            ↓
                    ❌ Hard to scale, slow, single server
```

### After (R2 Storage)
```
PDF Upload → Extract Images → Upload to R2: temp/{jobId}/images/
                            ↓
                    Return R2 public URLs
                            ↓
                    Submit → Move to R2: projects/{projectId}/images/
                            ↓
                    Store permanent R2 URLs in DB
                            ↓
                    ✅ Scalable, fast CDN, globally accessible
                            ↓
                    Cleanup Script (24h) → Delete old temp files
```

## 📊 Benefits

### Scalability
- ✅ **Before**: Limited by server disk space
- ✅ **After**: Unlimited R2 storage

### Performance
- ✅ **Before**: Single server, slow for remote users
- ✅ **After**: Global CDN, fast everywhere

### Reliability
- ✅ **Before**: Lost if server fails
- ✅ **After**: Replicated across Cloudflare edge

### Cost
- ✅ **Before**: Server storage + bandwidth costs
- ✅ **After**: $0.015/GB/month + NO egress fees

### Deployment
- ✅ **Before**: Hard to deploy (need persistent storage)
- ✅ **After**: Easy to deploy anywhere (stateless)

## 🚀 Next Steps

1. **Set up R2** (follow `CLOUDFLARE_R2_SETUP.md`)
   - Create bucket
   - Get API credentials
   - Update `.env`

2. **Test locally**
   ```bash
   npm run cleanup-r2  # Test connection
   npm run dev         # Start backend
   # Upload a PDF to test
   ```

3. **Deploy to production**
   - Update production `.env` with R2 credentials
   - Deploy updated backend
   - Set up automatic cleanup (cron/Task Scheduler)

4. **Monitor**
   - Check R2 dashboard for usage
   - Verify temp files are cleaned up
   - Check image loading performance

## 🔧 Configuration Required

Add these to `backend/.env`:

```env
# Cloudflare R2 Storage
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<your-access-key-id>
R2_SECRET_ACCESS_KEY=<your-secret-access-key>
R2_BUCKET_NAME=gulf-property-images
R2_PUBLIC_URL=https://images.yourdomain.com
```

## 🧪 Testing

```bash
# Test R2 connection
npm run cleanup-r2

# Should output:
# ✅ R2 connection successful
# ✅ Cleanup complete: 0 files deleted
```

## 📝 Backward Compatibility

- ✅ **Old local images**: Still work if already in DB
- ✅ **No R2 config**: Falls back to local storage
- ✅ **Gradual migration**: New uploads use R2, old stay local

## ⚠️ Important Notes

1. **Environment Variables**: Must be set for R2 to work
2. **Public URL**: Images must be publicly accessible
3. **CORS**: May need to configure CORS in R2 bucket settings
4. **Cleanup**: Run cleanup script regularly (daily recommended)
5. **Costs**: Monitor R2 usage in Cloudflare dashboard

## 📞 Troubleshooting

See `CLOUDFLARE_R2_SETUP.md` for detailed troubleshooting.

Quick checks:
- ✅ All environment variables set?
- ✅ Bucket name correct?
- ✅ API credentials valid?
- ✅ Public URL accessible?
- ✅ CORS configured?

## 🎉 Done!

Your backend is now ready to use Cloudflare R2 for scalable, fast image storage!
