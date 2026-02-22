#!/bin/bash
#
# Dubai Pulse Transport Data Downloader
# Downloads all RTA transport KML files from Dubai Pulse
#
# Usage: bash scripts/download-dubai-transport.sh
#

set -e

DATA_DIR="data/dubai-pulse"
mkdir -p "$DATA_DIR"

echo "🚇 Dubai Transport Data Downloader"
echo "=================================="
echo ""

# Download functions
download_file() {
    local name="$1"
    local url="$2"
    local output="$3"

    echo "📥 Downloading $name..."
    curl -sL -o "$DATA_DIR/$output" "$url"

    if [ -s "$DATA_DIR/$output" ]; then
        size=$(ls -lh "$DATA_DIR/$output" | awk '{print $5}')
        echo "   ✅ $output ($size)"
    else
        echo "   ❌ Failed to download $output"
    fi
}

# Metro
download_file "Metro Lines" \
    "https://www.dubaipulse.gov.ae/dataset/f114cfdd-e3d7-43d9-bc6b-b8527d27d393/resource/b716c365-215c-4bcd-913c-8f4097bab431/download/metro_lines_gis_2026-01-31_00-00-00.kml" \
    "Metro_Lines_GIS.kml"

download_file "Metro Stations" \
    "https://www.dubaipulse.gov.ae/dataset/ee34a48c-f98a-4646-b92c-243ab4555985/resource/1a8b1d0d-0e0e-45a1-839e-37326119b280/download/metro_stations_gis_2020-12-12_00-00-00.kml" \
    "Metro_Stations_GIS.kml"

# Tram
download_file "Tram Lines" \
    "https://www.dubaipulse.gov.ae/dataset/7ed4a85b-835a-4c7a-ac0c-1efc487efe9c/resource/09ffecb7-aeca-4f58-9eba-7a35a4c415db/download/tram_lines_gis_2026-01-31_00-00-00.kml" \
    "Tram_Lines_GIS.kml"

download_file "Tram Stations" \
    "https://www.dubaipulse.gov.ae/dataset/f23a2183-e07d-40e2-b2e7-126f4def33f4/resource/bb5eba6a-9486-4d7e-bb5d-2a9c470a3638/download/tram_stations_gis_2026-01-31_00-00-00.kml" \
    "Tram_Stations_GIS.kml"

# Bus
download_file "Bus Routes" \
    "https://www.dubaipulse.gov.ae/dataset/6c2f98d4-1284-4cc9-bc8b-d2eddb96fa33/resource/e752861f-5e5b-434b-8f8a-a702128a17ee/download/bus_routes_gis_2018-08-06_00-00-00.kml" \
    "Bus_Routes_GIS.kml"

download_file "Bus Stops" \
    "https://www.dubaipulse.gov.ae/dataset/bd3f8b98-7a8e-4d93-8d3a-7633d2c6a70e/resource/bda876c9-636f-45f8-a1be-c01d41cfd1ea/download/bus_stops_gis_2026-01-30_00-00-00.kml" \
    "Bus_Stops_GIS.kml"

# Other
download_file "Bicycle Tracks" \
    "https://www.dubaipulse.gov.ae/dataset/4bd334fe-5b89-4284-b4eb-a669aa001ba0/resource/08e124d1-fe5c-4f17-94c7-6d78ca34ac61/download/bicycle_tracks_2026-01-29_00-00-00.kml" \
    "Bicycle_Tracks.kml"

echo ""
echo "📁 Downloaded files:"
ls -lh "$DATA_DIR"/*.kml
echo ""
echo "✅ Download complete!"
