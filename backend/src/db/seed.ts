import pool from './pool'

const seedProjects = [
  {
    name: 'Marina Heights Tower',
    developer: 'Emaar Properties',
    location: JSON.stringify({
      lat: 25.0801,
      lng: 55.1410,
      address: 'Dubai Marina, Dubai',
      district: 'Dubai Marina'
    }),
    price: JSON.stringify({ min: 1500000, max: 8000000 }),
    completion_date: '2026-12-31',
    status: 'under-construction',
    images: ['https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800', 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800'],
    description: 'Experience waterfront luxury living in the heart of Dubai Marina. Marina Heights Tower offers stunning views of the Arabian Gulf and world-class amenities.',
    features: ['Waterfront Location', 'Private Beach Access', 'Smart Home Technology', 'Luxury Finishes'],
    floor_plans: JSON.stringify([
      { id: '1-1', name: '1 Bedroom Apartment', bedrooms: 1, bathrooms: 2, area: 850, price: 1500000 },
      { id: '1-2', name: '2 Bedroom Apartment', bedrooms: 2, bathrooms: 3, area: 1400, price: 2800000 },
      { id: '1-3', name: '3 Bedroom Penthouse', bedrooms: 3, bathrooms: 4, area: 3200, price: 8000000 }
    ]),
    payment_plan: JSON.stringify({
      down_payment: 20,
      during_construction: 50,
      on_handover: 30,
      installments: [
        { percentage: 10, period: '6 months' },
        { percentage: 10, period: '12 months' },
        { percentage: 10, period: '18 months' }
      ]
    }),
    amenities: ['Infinity Pool', 'Fitness Center', 'Spa & Wellness', 'Concierge Service', "Children's Play Area", 'BBQ Area', 'Covered Parking'],
    verified: true
  },
  // Add more seed data as needed
]

async function seed() {
  const client = await pool.connect()
  
  try {
    await client.query('BEGIN')
    
    console.log('🌱 Seeding database...')
    
    for (const project of seedProjects) {
      await client.query(
        `INSERT INTO projects (name, developer, location, price, completion_date, status, images, description, features, floor_plans, payment_plan, amenities, verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT DO NOTHING`,
        [
          project.name,
          project.developer,
          project.location,
          project.price,
          project.completion_date,
          project.status,
          project.images,
          project.description,
          project.features,
          project.floor_plans,
          project.payment_plan,
          project.amenities,
          project.verified
        ]
      )
    }
    
    await client.query('COMMIT')
    console.log('✅ Database seeded successfully')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('❌ Error seeding database:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch(console.error)
