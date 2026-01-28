/**
 * PDF Upload Card Component
 */

import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Upload, FileText, Sparkles, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

interface ProgressEvent {
  stage: string;
  message: string;
  progress: number;
  timestamp: number;
}

interface UploadCardProps {
  pdfFile: File | null;
  isProcessing: boolean;
  progress: number;
  currentStage: string;
  progressEvents: ProgressEvent[];
  error: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFileDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onProcess: () => void;
}

export function UploadCard({
  pdfFile,
  isProcessing,
  progress,
  currentStage,
  progressEvents,
  error,
  onFileChange,
  onFileDrop,
  onProcess,
}: UploadCardProps) {
  const { t } = useTranslation('upload');
  return (
    <Card className="sticky top-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-amber-600" />
          {t('uploadCard.title')}
        </CardTitle>
        <CardDescription>
          {t('uploadCard.subtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Area */}
        <div
          onDrop={onFileDrop}
          onDragOver={(e) => e.preventDefault()}
          className={`
            border-2 border-dashed rounded-xl p-8 text-center transition-all
            ${isProcessing 
              ? 'border-gray-300 bg-gray-50 cursor-not-allowed' 
              : 'border-amber-300 hover:border-amber-500 cursor-pointer bg-white hover:bg-amber-50'
            }
          `}
        >
          <input
            type="file"
            accept="application/pdf"
            onChange={onFileChange}
            className="hidden"
            id="pdf-upload-v2"
            disabled={isProcessing}
          />
          <label htmlFor="pdf-upload-v2" className={isProcessing ? 'cursor-not-allowed' : 'cursor-pointer'}>
            <Upload className={`h-12 w-12 mx-auto mb-3 ${isProcessing ? 'text-gray-400' : 'text-amber-500'}`} />
            <p className="text-slate-700 mb-1 font-medium">
              {pdfFile ? pdfFile.name : t('uploadCard.clickOrDrag')}
            </p>
            <p className="text-xs text-slate-500">
              {pdfFile ? `${(pdfFile.size / 1024 / 1024).toFixed(2)} MB` : t('uploadCard.supportInfo')}
            </p>
          </label>
        </div>

        {/* Process Button */}
        {pdfFile && !isProcessing && progress === 0 && (
          <Button
            onClick={onProcess}
            className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 shadow-lg"
            size="lg"
          >
            <Sparkles className="mr-2 h-5 w-5" />
            {t('documentUpload.aiExtract')}
          </Button>
        )}

        {/* Progress Section */}
        {isProcessing && (
          <div className="space-y-3">
            {/* Progress Bar */}
            <div>
              <div className="flex justify-between text-sm text-slate-600 mb-2">
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {currentStage}
                </span>
                <span className="font-semibold">{progress.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-gradient-to-r from-amber-600 to-orange-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Event Log */}
            <div className="bg-slate-50 rounded-lg p-3 max-h-64 overflow-y-auto">
              <div className="text-xs font-semibold text-slate-600 mb-2">{t('processing.processLog')}</div>
              <div className="space-y-1">
                {progressEvents.slice(-6).map((event, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <Clock className="h-3 w-3 text-slate-400 mt-0.5 flex-shrink-0" />
                    <span className="text-slate-700">{event.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {!isProcessing && progress === 100 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle className="h-5 w-5" />
              <span className="font-semibold">{t('processing.extractionComplete')}</span>
            </div>
            <p className="text-sm text-green-700 mt-1">
              {t('processing.checkFormAndSubmit')}
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-800">
              <XCircle className="h-5 w-5" />
              <span className="font-semibold">{t('processing.error')}</span>
            </div>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
