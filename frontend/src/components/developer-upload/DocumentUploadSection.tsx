import { useState } from 'react'
import { Upload, FileText, X, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '../ui/card'
import { Button } from '../ui/button'

// Warning threshold: 100MB (Cloudflare Free Plan limit)
// Files above this may fail if using Cloudflare proxy
const LARGE_FILE_WARNING_MB = 100

interface Document {
  id: string
  file: File
  label: string
}

interface DocumentUploadSectionProps {
  documents: Document[]
  isProcessing: boolean
  onAddDocuments: (files: File[]) => void
  onRemoveDocument: (id: string) => void
  onStartProcessing: () => void
}

export function DocumentUploadSection({
  documents,
  isProcessing,
  onAddDocuments,
  onRemoveDocument,
  onStartProcessing
}: DocumentUploadSectionProps) {
  const { t } = useTranslation('upload')
  const [sizeWarning, setSizeWarning] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const pdfFiles = files.filter(f => f.type === 'application/pdf')

    // Check for large files (warning only, don't block)
    const largeFiles = pdfFiles.filter(f => f.size > LARGE_FILE_WARNING_MB * 1024 * 1024)
    if (largeFiles.length > 0) {
      const names = largeFiles.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(0)}MB)`).join(', ')
      setSizeWarning(t('documentUpload.largeFileWarning', { files: names }))
    } else {
      setSizeWarning(null)
    }

    onAddDocuments(pdfFiles)
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        {/* Document List */}
        {documents.map(doc => (
          <div key={doc.id} className="flex items-center gap-2 p-3 bg-teal-50 rounded-lg border border-teal-200 hover:border-teal-300 transition-colors">
            <FileText className="h-5 w-5 text-teal-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate text-gray-900">{doc.file.name}</div>
              <div className="text-xs text-gray-500">{(doc.file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <button
              type="button"
              onClick={() => onRemoveDocument(doc.id)}
              disabled={isProcessing}
              className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ))}

        {/* Large File Warning */}
        {sizeWarning && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">{t('documentUpload.largeFileWarningTitle', 'Large file detected')}</p>
              <p className="text-amber-600">{sizeWarning}</p>
            </div>
            <button onClick={() => setSizeWarning(null)} className="ml-auto text-amber-400 hover:text-amber-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Upload Area */}
        <div className="border-2 border-dashed border-teal-300 rounded-lg p-8 text-center hover:border-teal-500 hover:bg-teal-50/50 transition-all">
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="hidden"
            id="pdf-upload"
            disabled={isProcessing}
            multiple
          />
          <label htmlFor="pdf-upload" className="cursor-pointer block">
            <Upload className="h-12 w-12 mx-auto mb-3 text-teal-500" />
            <p className="text-sm font-medium text-gray-900">{t('documentUpload.clickToUpload')}</p>
            <p className="text-xs text-gray-500 mt-2">{t('documentUpload.supportInfo', { maxSize: MAX_FILE_SIZE_MB })}</p>
          </label>
        </div>

        {/* Start Processing Button */}
        {documents.length > 0 && !isProcessing && (
          <Button
            onClick={onStartProcessing}
            className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600"
            size="lg"
          >
            <Upload className="mr-2 h-5 w-5" />
            {t('documentUpload.aiExtract')} ({documents.length})
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
