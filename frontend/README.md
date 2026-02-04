# Pinzos Frontend

Modern, elegant frontend for Pinzos - A New Way to Buy Off-Plan in Dubai

## Tech Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Animations**: Framer Motion
- **Maps**: React Leaflet (OpenStreetMap)
- **Routing**: React Router v6
- **Deployment**: Cloudflare Pages

## Features

### 🗺️ Interactive Map
- Real-time property visualization on OpenStreetMap
- Zoom and pan controls
- Click markers to view property details
- Smooth animations and transitions

### 🔍 Advanced Filtering
- Filter by developer
- Filter by district/area
- Price range slider
- Completion date filter
- Real-time filter application

### 🏠 Property Details
- Comprehensive project information
- Image gallery
- Floor plans with specifications
- Payment plan breakdown
- Amenities list
- Interactive location map

### ❤️ Favorites System
- Save properties using localStorage
- No login required for anonymous users
- Persistent across sessions
- Quick access from any page

### 📝 Developer Submission
- Form for developers to submit projects
- Input validation
- Success confirmation

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

Preview production build:
```bash
npm run preview
```

## Project Structure

```
src/
├── components/          # Reusable components
│   ├── ui/             # shadcn/ui components
│   ├── Layout.tsx      # Main layout wrapper
│   ├── MapView.tsx     # Interactive map component
│   └── FilterPanel.tsx # Property filters
├── pages/              # Page components
│   ├── HomePage.tsx
│   ├── ProjectDetailPage.tsx
│   ├── FavoritesPage.tsx
│   └── DeveloperSubmitPage.tsx
├── lib/                # Utility functions
│   ├── utils.ts        # General utilities
│   └── favorites.ts    # Favorites management
├── data/               # Mock data
│   └── mockProjects.ts
├── types/              # TypeScript types
│   └── index.ts
├── App.tsx             # Main app component
└── main.tsx           # Entry point
```

## Deployment to Cloudflare Pages

### Option 1: Connect to Git

1. Push your code to GitHub/GitLab
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
3. Pages > Create a project > Connect to Git
4. Select your repository
5. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `frontend`
6. Deploy!

### Option 2: Direct Upload

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Build and deploy
npm run build
wrangler pages deploy dist --project-name=pinzos
```

### Environment Variables

If you need to connect to the backend API, add environment variable:
- `VITE_API_URL` - Backend API URL

## Design Philosophy

The design follows a **luxury, professional aesthetic** targeting high-net-worth individuals:

- **Color Scheme**: Slate grays with elegant accents
- **Typography**: Bold headings with clean, readable body text
- **Animations**: Subtle, smooth transitions using Framer Motion
- **Layout**: Spacious, uncluttered with breathing room
- **Images**: High-quality property photos
- **User Experience**: Intuitive navigation, quick access to information

## Browser Support

- Chrome/Edge (last 2 versions)
- Firefox (last 2 versions)
- Safari (last 2 versions)

## License

MIT
