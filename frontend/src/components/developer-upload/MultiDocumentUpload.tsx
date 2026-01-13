/**
 * Multi-Document Upload Component
 * 
 * Allows uploading multiple PDFs (main brochure + payment plan + floor plans)
 */

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Upload, FileText, X, Plus } from 'lucide-react';

interface Document {
  id: string;
  file: File;
  type: 'main' | 'payment' | 'floorplan' | 'other';
  label: string;
}

interface MultiDocumentUploadProps {
  documents: Document[];
  isProcessing: boolean;
  onAddDocument: (file: File, type: Document['type']) => void;
  onRemoveDocument: (id: string) => void;
}

export function MultiDocumentUpload({
  documents,
  isProcessing,
  onAddDocument,
  onRemoveDocument,
}: MultiDocumentUploadProps) {
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: Document['type']) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      onAddDocument(file, type);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="h-5 w-5 text-amber-600" />
          文档上传（可上传多个）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Document List */}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200"
          >
            <FileText className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-gray-900 truncate">
                {doc.file.name}
              </div>
              <div className="text-xs text-gray-600">
                {doc.label} • {(doc.file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onRemoveDocument(doc.id)}
              disabled={isProcessing}
              className="flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {/* Add Document Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <div>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileSelect(e, 'main')}
              className="hidden"
              id="upload-main"
              disabled={isProcessing}
            />
            <label htmlFor="upload-main">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={isProcessing}
                asChild
              >
                <div>
                  <Plus className="h-4 w-4 mr-1" />
                  主手册
                </div>
              </Button>
            </label>
          </div>

          <div>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileSelect(e, 'payment')}
              className="hidden"
              id="upload-payment"
              disabled={isProcessing}
            />
            <label htmlFor="upload-payment">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={isProcessing}
                asChild
              >
                <div>
                  <Plus className="h-4 w-4 mr-1" />
                  付款计划
                </div>
              </Button>
            </label>
          </div>

          <div>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileSelect(e, 'floorplan')}
              className="hidden"
              id="upload-floorplan"
              disabled={isProcessing}
            />
            <label htmlFor="upload-floorplan">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={isProcessing}
                asChild
              >
                <div>
                  <Plus className="h-4 w-4 mr-1" />
                  户型图
                </div>
              </Button>
            </label>
          </div>

          <div>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileSelect(e, 'other')}
              className="hidden"
              id="upload-other"
              disabled={isProcessing}
            />
            <label htmlFor="upload-other">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={isProcessing}
                asChild
              >
                <div>
                  <Plus className="h-4 w-4 mr-1" />
                  其他
                </div>
              </Button>
            </label>
          </div>
        </div>

        <p className="text-xs text-gray-500 text-center">
          支持多个 PDF，AI 会合并分析所有文档
        </p>
      </CardContent>
    </Card>
  );
}
