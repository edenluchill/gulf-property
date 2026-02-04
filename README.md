# Pinzos - Dubai Off-Plan Properties Platform

> A modern, elegant platform connecting international buyers with Dubai's premium off-plan properties.

## 🌟 Overview

Pinzos is a comprehensive real estate platform designed specifically for overseas buyers interested in Dubai's off-plan property market. The platform provides:

- **Interactive Property Map** - Visualize all available properties on an interactive map
- **Advanced Filtering** - Filter by developer, location, price, and completion date
- **Detailed Project Information** - Floor plans, payment plans, amenities, and more
- **Favorites System** - Save properties for later review (no login required)
- **Developer Portal** - Direct submission system for new projects
- **AI-Ready Architecture** - Built to integrate AI-powered insights and recommendations

## 🏗️ Architecture

### Frontend
- **Tech**: React + TypeScript + Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **Maps**: React Leaflet (OpenStreetMap)
- **Animations**: Framer Motion
- **Deployment**: Cloudflare Pages

### Backend
- **Tech**: Express + TypeScript
- **Database**: PostgreSQL with JSONB
- **Deployment**: Hetzner Cloud
- **Security**: Helmet, CORS, Rate Limiting

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Setup database
cp .env.example .env
# Edit .env with your database credentials

# Create database and run schema
psql -U postgres -c "CREATE DATABASE pinzos;"
psql -U postgres -d pinzos -f src/db/schema.sql

# Start development server
npm run dev
```

API available at `http://localhost:3001`

## 📁 Project Structure

```
pinzos/
├── frontend/              # React frontend application
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components
│   │   ├── lib/          # Utilities and helpers
│   │   ├── data/         # Mock data
│   │   └── types/        # TypeScript definitions
│   └── package.json
│
├── backend/              # Express backend API
│   ├── src/
│   │   ├── routes/      # API routes
│   │   ├── db/          # Database config and migrations
│   │   └── types/       # TypeScript definitions
│   └── package.json
│
└── README.md
```

## 🎨 Features

### 1. Interactive Map View
- Real-time property markers
- Hover effects and animations
- Click to view quick details
- Responsive zoom and pan

### 2. Advanced Filtering
- Developer selection
- District/area filtering
- Price range slider (AED)
- Completion date filtering
- Real-time results update

### 3. Property Details
- Image galleries
- Multiple floor plan options
- Payment plan breakdown
- Comprehensive amenities list
- Location map
- Developer information

### 4. Favorites Management
- Save properties locally
- No account required
- Persistent storage
- Quick access dashboard

### 5. Developer Portal
- Submit new projects
- Validation and verification
- Contact information capture
- File upload support (coming soon)

## 🎯 Target Audience

**Primary Users**: High-net-worth international buyers looking to invest in Dubai real estate

**Design Philosophy**:
- Professional, trustworthy aesthetic
- Clean, modern interface
- Comprehensive information at fingertips
- Mobile-responsive design

## 🔒 Security Features

- Helmet.js security headers
- CORS protection
- Rate limiting
- Input validation
- SQL injection prevention
- XSS protection

## 📊 Database Schema

The platform uses PostgreSQL with flexible JSONB fields:

**Projects Table**:
- Core project information
- JSONB for location, pricing, floor plans
- Array fields for images, features, amenities
- Verification status flag

**Developer Submissions Table**:
- Unverified project submissions
- Contact information
- Awaiting admin approval

## 🚢 Deployment

### Frontend (Cloudflare Pages)
```bash
cd frontend
npm run build
# Connect to Cloudflare Pages via dashboard or CLI
```

### Backend (Hetzner)
```bash
cd backend
npm run build
# Deploy to Hetzner Cloud server
# Use PM2 for process management
```

## 🔮 Future Enhancements

- [ ] AI-powered property recommendations
- [ ] AI market analysis and insights
- [ ] Virtual property tours
- [ ] Mortgage calculator
- [ ] ROI calculator
- [ ] User authentication (optional)
- [ ] Email notifications
- [ ] Multi-language support (Arabic, Chinese, Russian)
- [ ] Currency conversion
- [ ] Document upload for developers
- [ ] Admin dashboard

## 📝 API Documentation

### Endpoints

**Projects**:
- `GET /api/projects` - List all verified projects
- `GET /api/projects/:id` - Get project details
- `GET /api/projects/meta/developers` - List developers
- `GET /api/projects/meta/districts` - List districts

**Submissions**:
- `POST /api/submissions` - Submit new project
- `GET /api/submissions` - List all submissions (admin)

**Health**:
- `GET /health` - API health check

## 🤝 Contributing

This is a private project. For questions or suggestions, please contact the development team.

## 📄 License

MIT License - See LICENSE file for details

## 👨‍💻 Development Team

Built with ❤️ for the Dubai real estate market

---

**Note**: This platform is designed for off-plan properties only. All properties are subject to verification before being displayed to end users.
