/**
 * LangGraph PDF Processor Test Page
 * 
 * Upload PDFs and view real-time processing progress
 */

import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Clock, TrendingUp, Home, Building2 } from 'lucide-react';

interface ProgressEvent {
  stage: string;
  message: string;
  progress: number;
  currentPage?: number;
  totalPages?: number;
  data?: any;
  timestamp: number;
}

interface ProcessingResult {
  success: boolean;
  buildingData: any;
  marketContext?: any;
  analysisReport?: any;
  marketingContent?: any;
  categorizedImages: any;
  processingTime: number;
  errors: string[];
  warnings: string[];
  jobId: string;
}

export default function LangGraphTestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([]);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const eventSourceRef = useRef<EventSource | null>(null);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/pdf') {
        setFile(selectedFile);
        setError(null);
      } else {
        setError('Please select a PDF file');
      }
    }
  };

  // Start processing
  const handleUpload = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProgressEvents([]);
    setProgress(0);
    setResult(null);
    setError(null);

    try {
      // Start processing
      const formData = new FormData();
      formData.append('file', file);
      formData.append('simplified', 'false');

      const response = await fetch('http://localhost:3001/api/langgraph-progress/start', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to start processing');
      }

      const newJobId = data.jobId;
      setJobId(newJobId);

      // Connect to SSE stream
      const eventSource = new EventSource(`http://localhost:3001/api/langgraph-progress/stream/${newJobId}`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const progressEvent: ProgressEvent = JSON.parse(event.data);
        
        setProgressEvents((prev) => [...prev, progressEvent]);
        setProgress(progressEvent.progress);

        // Check if complete
        if (progressEvent.stage === 'complete' && progressEvent.data) {
          setResult(progressEvent.data);
          setIsProcessing(false);
          eventSource.close();
        }

        // Check for errors
        if (progressEvent.stage === 'error') {
          setError(progressEvent.message);
          setIsProcessing(false);
          eventSource.close();
        }
      };

      eventSource.onerror = () => {
        console.error('SSE connection error');
        eventSource.close();
      };

    } catch (err) {
      setError(String(err));
      setIsProcessing(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🤖 LangGraph PDF Processor
          </h1>
          <p className="text-gray-600">
            Upload a real estate brochure and watch the AI agents extract data in real-time
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Upload & Progress */}
          <div className="space-y-6">
            {/* Upload Card */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Upload PDF</h2>
              
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  id="pdf-upload"
                  disabled={isProcessing}
                />
                <label
                  htmlFor="pdf-upload"
                  className="cursor-pointer flex flex-col items-center"
                >
                  <Upload className="w-12 h-12 text-gray-400 mb-3" />
                  <span className="text-gray-700 font-medium">
                    {file ? file.name : 'Choose a PDF file'}
                  </span>
                  <span className="text-sm text-gray-500 mt-1">
                    {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'Max 50 MB'}
                  </span>
                </label>
              </div>

              <button
                onClick={handleUpload}
                disabled={!file || isProcessing}
                className="w-full mt-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isProcessing ? 'Processing...' : 'Start Processing'}
              </button>
            </div>

            {/* Progress Card */}
            {isProcessing && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Processing Progress</h2>
                
                {/* Progress Bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>Progress</span>
                    <span>{progress.toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-blue-600 to-purple-600 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Event Log */}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {progressEvents.map((event, idx) => (
                    <div
                      key={idx}
                      className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg text-sm"
                    >
                      <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{event.message}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="text-blue-600 font-semibold">
                        {event.progress.toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start space-x-3">
                <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-red-900">Error</div>
                  <div className="text-sm text-red-700">{error}</div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="space-y-6">
            {result && (
              <>
                {/* Summary Card */}
                <div className="bg-gradient-to-br from-green-50 to-blue-50 rounded-xl shadow-lg p-6">
                  <div className="flex items-center space-x-3 mb-4">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                    <h2 className="text-2xl font-bold text-gray-900">
                      Processing Complete!
                    </h2>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white rounded-lg p-4">
                      <div className="text-sm text-gray-600">Processing Time</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {(result.processingTime / 1000).toFixed(1)}s
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <div className="text-sm text-gray-600">Units Extracted</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {result.buildingData?.units?.length || 0}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Building Data Card */}
                {result.buildingData && (
                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <div className="flex items-center space-x-2 mb-4">
                      <Building2 className="w-6 h-6 text-blue-600" />
                      <h3 className="text-xl font-semibold">Building Information</h3>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm text-gray-600">Project Name</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {result.buildingData.name || 'N/A'}
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-sm text-gray-600">Developer</div>
                        <div className="text-lg font-medium text-gray-800">
                          {result.buildingData.developer || 'N/A'}
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-sm text-gray-600">Location</div>
                        <div className="text-gray-800">
                          {result.buildingData.address || 'N/A'}
                        </div>
                      </div>

                      {result.buildingData.units && result.buildingData.units.length > 0 && (
                        <div>
                          <div className="text-sm text-gray-600 mb-2">Unit Types</div>
                          <div className="space-y-2">
                            {result.buildingData.units.slice(0, 5).map((unit: any, idx: number) => (
                              <div key={idx} className="bg-gray-50 rounded-lg p-3">
                                <div className="font-medium text-gray-900">{unit.name}</div>
                                <div className="text-sm text-gray-600">
                                  {unit.area} sqft • {unit.bedrooms}BR • {unit.bathrooms}BA
                                  {unit.price && ` • AED ${unit.price.toLocaleString()}`}
                                </div>
                              </div>
                            ))}
                            {result.buildingData.units.length > 5 && (
                              <div className="text-sm text-gray-500 text-center">
                                +{result.buildingData.units.length - 5} more units
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {result.buildingData.amenities && result.buildingData.amenities.length > 0 && (
                        <div>
                          <div className="text-sm text-gray-600 mb-2">Amenities</div>
                          <div className="flex flex-wrap gap-2">
                            {result.buildingData.amenities.slice(0, 8).map((amenity: string, idx: number) => (
                              <span
                                key={idx}
                                className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                              >
                                {amenity}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Marketing Content Card */}
                {result.marketingContent && (
                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <div className="flex items-center space-x-2 mb-4">
                      <TrendingUp className="w-6 h-6 text-purple-600" />
                      <h3 className="text-xl font-semibold">Marketing Content</h3>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-semibold text-gray-700 mb-1">Headline</div>
                        <div className="text-lg font-medium text-gray-900">
                          {result.marketingContent.headline}
                        </div>
                      </div>

                      {result.marketingContent.highlights && (
                        <div>
                          <div className="text-sm font-semibold text-gray-700 mb-2">Key Highlights</div>
                          <ul className="space-y-1">
                            {result.marketingContent.highlights.map((highlight: string, idx: number) => (
                              <li key={idx} className="text-sm text-gray-700 flex items-start">
                                <span className="text-green-600 mr-2">✓</span>
                                {highlight}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {result.marketingContent.twitter && (
                        <div>
                          <div className="text-sm font-semibold text-gray-700 mb-1">Twitter</div>
                          <div className="bg-blue-50 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">
                            {result.marketingContent.twitter}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Download JSON */}
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `langgraph-result-${jobId}.json`;
                    a.click();
                  }}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 py-3 rounded-lg font-medium transition-colors"
                >
                  Download Full Results (JSON)
                </button>
              </>
            )}

            {!result && !isProcessing && (
              <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">
                  Upload a PDF to see the extraction results here
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
