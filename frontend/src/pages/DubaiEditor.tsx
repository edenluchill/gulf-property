import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import AreasEditorEnhanced from './AreasEditorEnhanced'
import LandmarksEditor from './LandmarksEditor'
import { MapPin, Layers } from 'lucide-react'

export default function DubaiEditor() {
  const [activeTab, setActiveTab] = useState<'areas' | 'landmarks'>('areas')

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header with Tabs */}
      <div className="bg-white border-b px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-slate-900">Dubai Map Editor</h1>
          <p className="text-sm text-slate-600">Manage areas and landmarks on the map</p>
        </div>
        
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'areas' | 'landmarks')}>
          <TabsList className="grid w-[400px] grid-cols-2">
            <TabsTrigger value="areas" className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Areas ({8})
            </TabsTrigger>
            <TabsTrigger value="landmarks" className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Landmarks ({14})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'areas' ? <AreasEditorEnhanced /> : <LandmarksEditor />}
      </div>
    </div>
  )
}
