import { Upload, FileText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '../ui/card'
import { Button } from '../ui/button'

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
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const pdfFiles = files.filter(f => f.type === 'application/pdf')
    onAddDocuments(pdfFiles)
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        {/* Document List */}
        {documents.map(doc => (
          <div key={doc.id} className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200 hover:border-amber-300 transition-colors">
            <FileText className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate text-gray-900">{doc.file.name}</div>
              <div className="text-xs text-gray-500">{(doc.file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <button
              onClick={() => onRemoveDocument(doc.id)}
              disabled={isProcessing}
              className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ))}

        {/* Upload Area */}
        <div className="border-2 border-dashed border-amber-300 rounded-lg p-8 text-center hover:border-amber-500 hover:bg-amber-50/50 transition-all">
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
            <Upload className="h-12 w-12 mx-auto mb-3 text-amber-500" />
            <p className="text-sm font-medium text-gray-900">{t('documentUpload.clickToUpload')}</p>
            <p className="text-xs text-gray-500 mt-2">{t('documentUpload.supportInfo')}</p>
          </label>
        </div>

        {/* Start Processing Button */}
        {documents.length > 0 && !isProcessing && (
          <Button
            onClick={onStartProcessing}
            className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700"
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
