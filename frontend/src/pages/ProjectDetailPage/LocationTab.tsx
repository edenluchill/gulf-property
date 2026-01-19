import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { MapPin } from 'lucide-react'

interface LocationTabProps {
  buildingName: string
  areaName: string
  location: {
    lat: number
    lng: number
  }
}

export function LocationTab({ buildingName, areaName, location }: LocationTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Location</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-96 rounded-lg overflow-hidden">
          <MapContainer
            center={[location.lat, location.lng]}
            zoom={15}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[location.lat, location.lng]} />
          </MapContainer>
        </div>
        <div className="mt-4 p-4 bg-slate-50 rounded-lg">
          <div className="flex items-start">
            <MapPin className="h-5 w-5 text-primary mr-2 mt-0.5" />
            <div>
              <div className="font-semibold">{buildingName}</div>
              <div className="text-sm text-slate-600">{areaName}, Dubai</div>
              <div className="text-xs text-slate-500 mt-1">
                Coordinates: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
