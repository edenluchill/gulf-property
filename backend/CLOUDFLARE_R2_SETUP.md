# Cloudflare R2 Setup Guide

This guide explains how to configure Cloudflare R2 for image storage in the Gulf Property platform.

## Why R2?

- ✅ **Scalable**: No storage limits, handles millions of images
- ✅ **Fast**: Global CDN with edge caching
- ✅ **Cost-effective**: No egress fees, cheaper than S3
- ✅ **Easy**: S3-compatible API, drop-in replacement

## Architecture

### Image Flow

1. **PDF Upload** → Images extracted → **R2 Temp Storage** (`temp/{jobId}/images/`)
2. **User Reviews** → Makes edits → Still in temp
3. **User Submits** → Images moved → **R2 Permanent Storage** (`projects/{projectId}/images/`)
4. **Cleanup Script** → Deletes temp files older than 24 hours

### Storage Structure

```
gulf-property-images/  (R2 Bucket)
├── temp/
│   ├── job_1234567890/
│   │   └── images/
│   │       ├── page_1.png
│   │       ├── page_2.png
│   │       └── ...
│   └── job_9876543210/
│       └── images/
│           └── ...
└── projects/
    ├── uuid-project-1/
    │   └── images/
    │       ├── render_1.png
    │       ├── floorplan_1.png
    │       └── ...
    └── uuid-project-2/
        └── images/
            └── ...
```

## Setup Steps

### 1. Create Cloudflare Account

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Sign up or log in
3. Navigate to **R2** in the sidebar

### 2. Create R2 Bucket

1. Click **"Create bucket"**
2. Name: `gulf-property-images` (or your choice)
3. Location: Choose closest to your users (e.g., APAC for Dubai)
4. Click **"Create bucket"**

### 3. Create API Token

1. In R2 dashboard, click **"Manage R2 API Tokens"**
2. Click **"Create API Token"**
3. Name: `gulf-property-api-token`
4. Permissions: **Read & Write**
5. Scope: Select your bucket or "All buckets"
6. Click **"Create API Token"**
7. **IMPORTANT**: Copy the credentials (Access Key ID & Secret Access Key)
   - You won't be able to see the secret again!

### 4. Set Up Public Access (Optional but Recommended)

#### Option A: Custom Domain (Recommended)
1. In your bucket settings, click **"Settings"** → **"Custom Domains"**
2. Add domain: `images.yourdomain.com`
3. Add CNAME record in your DNS:
   ```
   images.yourdomain.com CNAME bucket-name.r2.dev
   ```
4. Enable SSL (automatic with Cloudflare)

#### Option B: Public Bucket URL
1. Get your bucket's public URL: `https://<bucket-name>.<account-id>.r2.dev`
2. Enable public access in bucket settings if needed

### 5. Configure Backend

Update `backend/.env`:

```env
# Cloudflare R2 Storage
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<your-access-key-id>
R2_SECRET_ACCESS_KEY=<your-secret-access-key>
R2_BUCKET_NAME=gulf-property-images
R2_PUBLIC_URL=https://images.yourdomain.com  # Or bucket public URL
```

**Find your Account ID:**
- Go to R2 dashboard
- Your account ID is in the URL: `https://dash.cloudflare.com/<account-id>/r2`
- Or find it in "Account ID" on the right sidebar

**Example:**
```env
R2_ENDPOINT=https://abc123def456.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=1234567890abcdef1234567890abcdef
R2_SECRET_ACCESS_KEY=abcdef1234567890abcdef1234567890abcdef1234567890
R2_BUCKET_NAME=gulf-property-images
R2_PUBLIC_URL=https://images.gulfproperty.ae
```

### 6. Test Connection

Run the test script:

```bash
cd backend
npm run cleanup-r2
```

If successful, you should see:
```
✅ R2 connection successful
```

## Usage

### Automatic (No Code Changes Needed)

Once configured, the system automatically:

1. **PDF Processing**: Uploads extracted images to R2 temp storage
2. **Frontend Display**: Shows images from R2 URLs
3. **Project Submit**: Moves images from temp to permanent
4. **Cleanup**: Run periodically to delete old temp files

### Manual Cleanup

```bash
# Run cleanup script
npm run cleanup-r2

# Or with PowerShell
./cleanup-r2-temp-files.ps1
```

### Set Up Automatic Cleanup (Production)

#### Linux/Ubuntu (Cron Job)
```bash
# Edit crontab
crontab -e

# Add daily cleanup at 2 AM
0 2 * * * cd /path/to/backend && npm run cleanup-r2
```

#### Windows (Task Scheduler)
1. Open Task Scheduler
2. Create Basic Task
3. Trigger: Daily at 2:00 AM
4. Action: Start a program
   - Program: `powershell.exe`
   - Arguments: `-ExecutionPolicy Bypass -File "C:\path\to\backend\cleanup-r2-temp-files.ps1"`

## Monitoring

### Check Storage Usage

1. Go to Cloudflare R2 dashboard
2. Click your bucket
3. See **Storage Metrics** for usage, operations, and costs

### Expected Usage

- **Temp storage**: ~100MB per PDF job (deleted after 24h)
- **Permanent storage**: ~5-10MB per project
- **For 100 projects**: ~500MB-1GB permanent + rolling temp

## Troubleshooting

### "R2 connection failed"

**Check:**
1. ✅ All R2 environment variables are set in `.env`
2. ✅ Access Key ID and Secret are correct
3. ✅ Endpoint format: `https://<account-id>.r2.cloudflarestorage.com`
4. ✅ Bucket name matches exactly
5. ✅ API token has correct permissions

### "Failed to upload image to R2"

**Check:**
1. ✅ API token has **Write** permission
2. ✅ Bucket exists and is accessible
3. ✅ No network/firewall issues

### "Images not displaying"

**Check:**
1. ✅ `R2_PUBLIC_URL` is correct
2. ✅ Public access is enabled (for custom domain)
3. ✅ CORS settings allow your frontend domain
4. ✅ Images exist in bucket (check R2 dashboard)

### Add CORS Settings (If Images Don't Load)

In R2 bucket settings → **CORS Policy**:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://yourdomain.com"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

## Costs

Cloudflare R2 pricing (as of 2024):

- **Storage**: $0.015/GB/month
- **Class A Operations** (write): $4.50 per million
- **Class B Operations** (read): $0.36 per million
- **Egress**: **FREE** 🎉

**Example cost for 100 projects/month:**
- Storage: 1GB = $0.015
- Uploads: ~1,000 operations = $0.004
- Downloads: ~100,000 page views = $0.036
- **Total: ~$0.055/month** 💰

Compare to S3: ~$10-20/month for same usage (due to egress fees)

## Migration from Local Storage

If you're already using local storage:

1. ✅ Set up R2 as described above
2. ✅ New uploads will automatically use R2
3. Old local images will continue to work
4. Optional: Migrate old images with a script (contact support)

## Support

For issues or questions:
- Check logs: `backend/logs/`
- Run test: `npm run cleanup-r2`
- Documentation: [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
