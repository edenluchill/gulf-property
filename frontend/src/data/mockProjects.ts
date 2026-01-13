import { Project } from '../types'

export const mockProjects: Project[] = [
  {
    id: '1',
    name: 'Marina Heights Tower',
    developer: 'Emaar Properties',
    location: {
      lat: 25.0801,
      lng: 55.1410,
      address: 'Dubai Marina, Dubai',
      district: 'Dubai Marina'
    },
    price: {
      min: 1500000,
      max: 8000000
    },
    units: 245,
    completionDate: '2026-12-31',
    status: 'under-construction',
    images: [
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800',
      'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800'
    ],
    description: 'Experience waterfront luxury living in the heart of Dubai Marina. Marina Heights Tower offers stunning views of the Arabian Gulf and world-class amenities.',
    features: [
      'Waterfront Location',
      'Private Beach Access',
      'Smart Home Technology',
      'Luxury Finishes'
    ],
    floorPlans: [
      {
        id: '1-1',
        name: '1 Bedroom Apartment',
        bedrooms: 1,
        bathrooms: 2,
        area: 850,
        price: 1500000
      },
      {
        id: '1-2',
        name: '2 Bedroom Apartment',
        bedrooms: 2,
        bathrooms: 3,
        area: 1400,
        price: 2800000
      },
      {
        id: '1-3',
        name: '3 Bedroom Penthouse',
        bedrooms: 3,
        bathrooms: 4,
        area: 3200,
        price: 8000000
      }
    ],
    paymentPlan: {
      downPayment: 20,
      duringConstruction: 50,
      onHandover: 30,
      installments: [
        { percentage: 10, period: '6 months' },
        { percentage: 10, period: '12 months' },
        { percentage: 10, period: '18 months' }
      ]
    },
    amenities: [
      'Infinity Pool',
      'Fitness Center',
      'Spa & Wellness',
      'Concierge Service',
      'Children\'s Play Area',
      'BBQ Area',
      'Covered Parking'
    ]
  },
  {
    id: '2',
    name: 'Downtown Vista',
    developer: 'Emaar Properties',
    location: {
      lat: 25.1972,
      lng: 55.2744,
      address: 'Downtown Dubai',
      district: 'Downtown Dubai'
    },
    price: {
      min: 2000000,
      max: 12000000
    },
    units: 186,
    completionDate: '2027-06-30',
    status: 'under-construction',
    images: [
      'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=800',
      'https://images.unsplash.com/photo-1567953545957-b5c9d4536912?w=800'
    ],
    description: 'Iconic tower in Downtown Dubai with breathtaking views of Burj Khalifa. Premium residences designed for sophisticated living.',
    features: [
      'Burj Khalifa Views',
      'Premium Location',
      'High-End Finishes',
      '24/7 Security'
    ],
    floorPlans: [
      {
        id: '2-1',
        name: '2 Bedroom Apartment',
        bedrooms: 2,
        bathrooms: 3,
        area: 1600,
        price: 2000000
      },
      {
        id: '2-2',
        name: '3 Bedroom Apartment',
        bedrooms: 3,
        bathrooms: 4,
        area: 2400,
        price: 4500000
      },
      {
        id: '2-3',
        name: '4 Bedroom Penthouse',
        bedrooms: 4,
        bathrooms: 5,
        area: 5000,
        price: 12000000
      }
    ],
    paymentPlan: {
      downPayment: 20,
      duringConstruction: 60,
      onHandover: 20
    },
    amenities: [
      'Rooftop Pool',
      'State-of-the-art Gym',
      'Yoga Studio',
      'Business Center',
      'Valet Parking',
      'Kids Club',
      'Cinema Room'
    ]
  },
  {
    id: '3',
    name: 'Palm Residence',
    developer: 'Nakheel',
    location: {
      lat: 25.1124,
      lng: 55.1390,
      address: 'Palm Jumeirah, Dubai',
      district: 'Palm Jumeirah'
    },
    price: {
      min: 3500000,
      max: 25000000
    },
    units: 82,
    completionDate: '2026-09-30',
    status: 'under-construction',
    images: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800'
    ],
    description: 'Exclusive beachfront residences on the iconic Palm Jumeirah. Unparalleled luxury with private beach access and stunning sea views.',
    features: [
      'Beachfront Living',
      'Private Beach',
      'Panoramic Sea Views',
      'Luxury Resort Amenities'
    ],
    floorPlans: [
      {
        id: '3-1',
        name: '3 Bedroom Villa',
        bedrooms: 3,
        bathrooms: 4,
        area: 3500,
        price: 3500000
      },
      {
        id: '3-2',
        name: '4 Bedroom Villa',
        bedrooms: 4,
        bathrooms: 5,
        area: 5000,
        price: 6500000
      },
      {
        id: '3-3',
        name: '6 Bedroom Mansion',
        bedrooms: 6,
        bathrooms: 7,
        area: 12000,
        price: 25000000
      }
    ],
    paymentPlan: {
      downPayment: 25,
      duringConstruction: 50,
      onHandover: 25
    },
    amenities: [
      'Private Beach',
      'Infinity Pool',
      'Private Marina',
      'Spa',
      'Tennis Courts',
      'Golf Course Access',
      'Fine Dining',
      'Kids Play Area'
    ]
  },
  {
    id: '4',
    name: 'Business Bay Tower',
    developer: 'DAMAC Properties',
    location: {
      lat: 25.1897,
      lng: 55.2632,
      address: 'Business Bay, Dubai',
      district: 'Business Bay'
    },
    price: {
      min: 900000,
      max: 3500000
    },
    units: 342,
    completionDate: '2026-03-31',
    status: 'under-construction',
    images: [
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800',
      'https://images.unsplash.com/photo-1565402170291-8491f14678db?w=800'
    ],
    description: 'Modern residential tower in the vibrant Business Bay district. Perfect for professionals seeking convenience and urban lifestyle.',
    features: [
      'Central Location',
      'Metro Access',
      'Modern Design',
      'Investment Opportunity'
    ],
    floorPlans: [
      {
        id: '4-1',
        name: 'Studio',
        bedrooms: 0,
        bathrooms: 1,
        area: 450,
        price: 900000
      },
      {
        id: '4-2',
        name: '1 Bedroom',
        bedrooms: 1,
        bathrooms: 2,
        area: 750,
        price: 1400000
      },
      {
        id: '4-3',
        name: '2 Bedroom',
        bedrooms: 2,
        bathrooms: 3,
        area: 1300,
        price: 3500000
      }
    ],
    paymentPlan: {
      downPayment: 10,
      duringConstruction: 50,
      onHandover: 40
    },
    amenities: [
      'Swimming Pool',
      'Gym',
      'Steam & Sauna',
      'Covered Parking',
      'Retail Outlets',
      'Landscaped Gardens'
    ]
  },
  {
    id: '5',
    name: 'Arabian Ranches III',
    developer: 'Emaar Properties',
    location: {
      lat: 25.0535,
      lng: 55.2708,
      address: 'Arabian Ranches, Dubai',
      district: 'Arabian Ranches'
    },
    price: {
      min: 2200000,
      max: 4500000
    },
    units: 128,
    completionDate: '2026-06-30',
    status: 'under-construction',
    images: [
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800'
    ],
    description: 'Family-friendly villas in a serene community with lush green spaces. Perfect blend of tranquility and modern amenities.',
    features: [
      'Gated Community',
      'Family-Friendly',
      'Green Spaces',
      'Golf Course Views'
    ],
    floorPlans: [
      {
        id: '5-1',
        name: '3 Bedroom Villa',
        bedrooms: 3,
        bathrooms: 4,
        area: 2200,
        price: 2200000
      },
      {
        id: '5-2',
        name: '4 Bedroom Villa',
        bedrooms: 4,
        bathrooms: 5,
        area: 3100,
        price: 3200000
      },
      {
        id: '5-3',
        name: '5 Bedroom Villa',
        bedrooms: 5,
        bathrooms: 6,
        area: 4200,
        price: 4500000
      }
    ],
    paymentPlan: {
      downPayment: 20,
      duringConstruction: 50,
      onHandover: 30
    },
    amenities: [
      'Community Pool',
      'Golf Course',
      'Parks & Playgrounds',
      'Retail Center',
      'Schools Nearby',
      'Healthcare Facilities',
      'Sports Facilities'
    ]
  },
  {
    id: '6',
    name: 'City Walk Apartments',
    developer: 'Meraas',
    location: {
      lat: 25.2278,
      lng: 55.2842,
      address: 'City Walk, Al Wasl, Dubai',
      district: 'City Walk'
    },
    price: {
      min: 1800000,
      max: 6500000
    },
    units: 156,
    completionDate: '2027-03-31',
    status: 'upcoming',
    images: [
      'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800',
      'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=800'
    ],
    description: 'Vibrant urban living at City Walk. Contemporary apartments in a pedestrian-friendly community with world-class retail and dining.',
    features: [
      'Urban Lifestyle',
      'Retail & Dining',
      'Walkable Community',
      'Art & Culture Hub'
    ],
    floorPlans: [
      {
        id: '6-1',
        name: '1 Bedroom',
        bedrooms: 1,
        bathrooms: 2,
        area: 900,
        price: 1800000
      },
      {
        id: '6-2',
        name: '2 Bedroom',
        bedrooms: 2,
        bathrooms: 3,
        area: 1500,
        price: 3200000
      },
      {
        id: '6-3',
        name: '3 Bedroom Penthouse',
        bedrooms: 3,
        bathrooms: 4,
        area: 2800,
        price: 6500000
      }
    ],
    paymentPlan: {
      downPayment: 20,
      duringConstruction: 60,
      onHandover: 20
    },
    amenities: [
      'Rooftop Terrace',
      'Fitness Center',
      'Retail Outlets',
      'Restaurants & Cafes',
      'Art Galleries',
      'Event Spaces',
      'Jogging Track'
    ]
  }
]

export const developers = Array.from(new Set(mockProjects.map(p => p.developer)))
export const districts = Array.from(new Set(mockProjects.map(p => p.location.district)))
