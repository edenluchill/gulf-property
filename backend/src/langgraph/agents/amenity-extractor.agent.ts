/**
 * 配套设施提取器（内联版）
 * 
 * 由page-analyzer调用，在页面分析时直接提取
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * ⭐ AI智能去重、规范化和过滤
 * 
 * 输入：从多个页面提取的所有amenities（可能有重复/同义词/基础设施）
 * 输出：去重后的有价值amenities列表
 * 
 * 优势：
 * - 激进合并相似amenities（Kids' Play Area = Play Area = Kids' Pool）
 * - 过滤基础设施（如洗手间、淋浴、储物柜等）
 * - 保留真正有价值的差异化amenities
 */
export async function deduplicateAmenitiesWithAI(rawAmenities: string[]): Promise<string[]> {
  if (rawAmenities.length === 0) return [];
  
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `You are a real estate amenity expert. Clean up this messy amenities list.

INPUT (raw amenities from brochure):
${JSON.stringify(rawAmenities, null, 2)}

TASK: Return ONLY meaningful, differentiating amenities that buyers care about.

⚠️ AGGRESSIVE MERGING - Merge these groups into ONE item:
- "Gym", "Fitness Center", "Health Club", "Gym & Changing Rooms" → "Gym"
- "Swimming Pool", "Pool", "Upper Family Pool", "Lower Lap Pool", "Kids' Pool", "Pool Deck" → "Swimming Pool"
- "Play Area", "Kids' Play Area", "Kids' Club", "Active Zone", "Craft Area" → "Kids' Play Area"
- "Gardens", "Sky Garden", "Private Gardens", "Sky Garden Gathering Spaces" → "Sky Garden"
- "BBQ Area", "BBQ" → "BBQ Area"
- "Lobby", "Entrance", "Grand Double-height Entrance Lobby", "Entrance Gate" → "Lobby"
- "Lounge", "Social Lounge", "Family Lounge", "Events Lounge", "Sky Lounge" → "Lounge"
- "Yoga Studio", "Wellness Studio", "Wellness Space", "Wellness Terrace" → "Yoga Studio"
- "Co-working Space", "Co-working & Gallery" → "Co-working Space"
- "Cinema", "Cinema Room" → "Cinema"
- "Tennis Court", "Padel Court", "Sports Court" → "Sports Court"
- "Parking", "Visitor Parking", "Parking Access" → (EXCLUDE - basic facility)

🚫 EXCLUDE - Common facilities every building has:
- Washrooms, Showers, Lockers, Changing Rooms
- Walking Paths, Promenade, Seating Areas
- Lobbies, Entrances, Reception (unless truly exceptional)
- Parking, Elevators, Corridors
- Basic functional spaces like "Meeting Room", "Phone Booth"

✅ KEEP - Valuable amenities:
- Pools, Gyms, Sports facilities (merged)
- Gardens, Rooftop spaces
- Entertainment (Cinema, Arcade, Library)
- Kids facilities (merged)
- Unique features (Helipad, Observatory, Spa)

OUTPUT: Return 5-15 items max. Use common terms.
{"amenities": ["Swimming Pool", "Gym", "Sky Garden", ...]}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    const deduplicated = parsed.amenities || [];
    
    console.log(`   🤖 AI cleanup: ${rawAmenities.length} → ${deduplicated.length} amenities`);
    
    return deduplicated;

  } catch (error) {
    console.error('   ✗ AI deduplication failed, using fallback filter:', error);
    // Fallback: 基础去重 + 硬编码过滤
    return fallbackFilterAmenities(rawAmenities);
  }
}

/**
 * Fallback过滤器：当AI失败时使用
 */
function fallbackFilterAmenities(amenities: string[]): string[] {
  // 排除词列表
  const excludeKeywords = [
    'wash room', 'washroom', 'shower', 'locker', 'changing room',
    'walking path', 'promenade', 'corridor', 'elevator',
    'phone booth', 'meeting room', 'reception', 'entrance gate',
    'parking', 'access', 'male', 'female', 'toilet',
    'storage', 'lobby', 'entrance'
  ];

  // 合并规则
  const mergeRules: Record<string, string> = {
    'pool': 'Swimming Pool',
    'gym': 'Gym',
    'fitness': 'Gym',
    'garden': 'Sky Garden',
    'play area': 'Kids\' Play Area',
    'kids': 'Kids\' Play Area',
    'lounge': 'Lounge',
    'cinema': 'Cinema',
    'bbq': 'BBQ Area',
    'yoga': 'Yoga Studio',
    'wellness': 'Yoga Studio',
    'co-working': 'Co-working Space',
  };

  const filtered = new Set<string>();

  for (const amenity of amenities) {
    const lower = amenity.toLowerCase();
    
    // 排除基础设施
    if (excludeKeywords.some(keyword => lower.includes(keyword))) {
      continue;
    }

    // 尝试合并
    let merged = false;
    for (const [keyword, standard] of Object.entries(mergeRules)) {
      if (lower.includes(keyword)) {
        filtered.add(standard);
        merged = true;
        break;
      }
    }

    // 如果没有合并规则，保留原值（但要合理）
    if (!merged && amenity.length > 3 && amenity.length < 30) {
      filtered.add(amenity);
    }
  }

  return Array.from(filtered).slice(0, 15); // 最多15个
}

/**
 * 从单页提取amenities（快速、轻量级）
 */
export async function extractAmenities(
  imageUrl: string,
  pageNumber: number
): Promise<string[]> {
  
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `Extract VALUABLE amenities from this page. 

✅ EXTRACT (valuable differentiating amenities):
- Swimming Pool, Gym, Spa, Sauna
- Sky Garden, Rooftop Terrace, Gardens
- Kids' Play Area, Kids' Club  
- BBQ Area, Picnic Area
- Sports Court, Tennis Court, Padel Court
- Cinema, Library, Arcade
- Co-working Space, Business Center
- Yoga Studio, Wellness Center
- Jogging Track, Cycling Track
- Pet Park, Dog Park
- Helipad, Observatory (unique features)

🚫 IGNORE (basic facilities every building has):
- Lobbies, Entrances, Reception, Gates
- Elevators, Corridors, Staircases
- Parking, Visitor Parking
- Washrooms, Showers, Changing Rooms, Lockers
- Walking Paths, Seating Areas, Promenades
- Phone Booths, Meeting Rooms
- Storage Rooms, Service Areas

Return JSON: {"amenities": ["Swimming Pool", "Gym", ...]}
- Use simple English names
- NO duplicates
- Return [] if none found`;

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    const amenities: string[] = parsed.amenities || [];
    const unique = Array.from(new Set(amenities));
    
    return unique;

  } catch (error) {
    console.error(`   ✗ Error extracting amenities from page ${pageNumber}:`, error);
    return [];
  }
}
