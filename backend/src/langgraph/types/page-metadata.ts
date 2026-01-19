/**
 * 页面元数据类型定义
 * 
 * 核心原则：AI做标记，代码做分配
 * - AI负责：分析页面，生成PageMetadata
 * - 代码负责：基于标记做边界扫描和图片分配
 */

/**
 * 页面类型枚举
 */
export enum PageType {
  // 户型相关
  UNIT_ANCHOR = 'unit_anchor',              // 户型锚点页（详情+平面图）
  UNIT_FLOORPLAN_ONLY = 'unit_floorplan_only', // 仅平面图
  UNIT_RENDERING = 'unit_rendering',        // 户型渲染图
  UNIT_INTERIOR = 'unit_interior',          // 户型内设图
  UNIT_DETAIL = 'unit_detail',              // 户型详情（价格、面积等）
  
  // 项目相关
  PROJECT_COVER = 'project_cover',          // 封面
  PROJECT_OVERVIEW = 'project_overview',    // 项目概览
  PROJECT_SUMMARY = 'project_summary',      // 项目总结（Overall Characteristics）⭐
  PROJECT_RENDERING = 'project_rendering',  // 项目外观渲染
  PROJECT_AERIAL = 'project_aerial',        // 航拍/全景图
  PROJECT_LOCATION_MAP = 'project_location_map', // 位置地图
  PROJECT_MASTER_PLAN = 'project_master_plan',   // 总平面图
  TOWER_CHARACTERISTICS = 'tower_characteristics', // Tower特性页 ⭐
  
  // 配套设施
  AMENITIES_LIST = 'amenities_list',        // 配套列表
  AMENITIES_IMAGES = 'amenities_images',    // 配套设施图片
  
  // 商业信息
  PAYMENT_PLAN = 'payment_plan',            // 付款计划
  PRICING_TABLE = 'pricing_table',          // 价格表
  
  // 分隔页
  SECTION_TITLE = 'section_title',          // 章节标题页（如 "FLOOR PLANS"）
  SECTION_DIVIDER = 'section_divider',      // 分隔页
  
  // 其他
  GENERAL_TEXT = 'general_text',            // 通用文字页
  BACK_COVER = 'back_cover',                // 封底
  UNKNOWN = 'unknown',                      // 未知类型
}

/**
 * 次要页面类型（可多个）
 */
export enum PageSubType {
  HAS_LOGO = 'has_logo',                    // 有项目logo
  HAS_MARKETING = 'has_marketing',          // 有营销文案
  HAS_CONTACT = 'has_contact',              // 有联系方式
  HAS_DISCLAIMER = 'has_disclaimer',        // 有免责声明
  FULL_PAGE_IMAGE = 'full_page_image',      // 整页图片
  SPREAD_LEFT = 'spread_left',              // 跨页左侧
  SPREAD_RIGHT = 'spread_right',            // 跨页右侧
}

/**
 * 图片类别枚举
 */
export enum ImageCategory {
  // 户型图片
  FLOOR_PLAN = 'floor_plan',                        // 平面图
  UNIT_EXTERIOR = 'unit_exterior',                  // 户型外观
  UNIT_INTERIOR_LIVING = 'unit_interior_living',    // 客厅
  UNIT_INTERIOR_BEDROOM = 'unit_interior_bedroom',  // 卧室
  UNIT_INTERIOR_KITCHEN = 'unit_interior_kitchen',  // 厨房
  UNIT_INTERIOR_BATHROOM = 'unit_interior_bathroom', // 浴室
  UNIT_BALCONY = 'unit_balcony',                    // 阳台
  
  // 项目图片
  BUILDING_EXTERIOR = 'building_exterior',          // 建筑外观
  BUILDING_AERIAL = 'building_aerial',              // 航拍图
  BUILDING_ENTRANCE = 'building_entrance',          // 入口
  LOCATION_MAP = 'location_map',                    // 位置地图
  MASTER_PLAN = 'master_plan',                      // 总平面图
  
  // 配套设施
  AMENITY_POOL = 'amenity_pool',                    // 游泳池
  AMENITY_GYM = 'amenity_gym',                      // 健身房
  AMENITY_GARDEN = 'amenity_garden',                // 花园
  AMENITY_LOUNGE = 'amenity_lounge',                // 休息室
  AMENITY_OTHER = 'amenity_other',                  // 其他配套
  
  // 其他
  LOGO = 'logo',                                    // Logo
  ICON = 'icon',                                    // 图标
  DIAGRAM = 'diagram',                              // 图表
  UNKNOWN = 'unknown',                              // 未知
}

/**
 * 图片URL变体（多尺寸）
 */
export interface ImageUrls {
  original: string;    // 1920×1080 - Full quality for detail pages
  large: string;       // 1280×720 - Desktop listings
  medium: string;      // 800×450 - Tablet/cards
  thumbnail: string;   // 400×225 - Mobile previews
}

/**
 * 图片元数据
 */
export interface PageImage {
  imageId: string;              // 唯一ID
  imagePath: string;            // R2 URL或本地路径（单个尺寸，向后兼容）
  imageUrls?: ImageUrls;        // ⭐ 多尺寸URLs（如果可用）
  pageNumber: number;           // 所在页码
  
  // AI分类
  category: ImageCategory;      // 图片类别
  confidence: number;           // 分类置信度 (0-1)
  shouldUse?: boolean;          // ⭐ NEW: AI标记是否应该使用这张图片
  
  // 特征
  features: {
    isFullPage: boolean;        // 是否占满整页
    hasDimensions: boolean;     // 是否有尺寸标注
    hasScale: boolean;          // 是否有比例尺
    dominantColor?: string;     // 主色调（hex）
  };
  
  // AI描述
  aiDescription?: string;       // AI生成的图片描述
  detectedLabels?: string[];    // 检测到的标签（如 "bedroom", "balcony"）
  
  // 营销文案
  marketingText?: string;       // 图片上的营销文字
}

/**
 * 户型页面信息
 */
export interface UnitPageInfo {
  // 户型识别
  unitTypeName?: string;        // 户型名称（如 "DSTH-M1", "Type A"）
  unitCategory?: string;        // 户型分类（如 "4BR", "Studio"）
  
  // 详细信息
  hasDetailedSpecs: boolean;    // 是否有详细规格
  specs?: {
    area?: number;              // 总面积 (Total Area / BUA)
    suiteArea?: number;         // 室内面积 (Suite Area / Internal Area)
    balconyArea?: number;       // 阳台面积 (Balcony / Terrace)
    bedrooms?: number;          // 卧室数
    bathrooms?: number;         // 浴室数
    price?: number;             // 价格 (AED)
    pricePerSqft?: number;      // 单价 (AED/sqft)
  };
  
  // 户型特征 (从平面图提取)
  features?: string[];          // 特征列表（如 "Balcony", "Walk-in closet", "En-suite bathroom"）
  
  // 营销内容 (AI生成)
  description?: string;         // 3-5句专业推销文案，描述布局优势、设计特点、适合人群
  
  // 平面图
  hasFloorPlan: boolean;        // 是否有平面图
  floorPlanImageId?: string;    // 平面图ID
  
  // 该页在户型序列中的角色
  roleInUnit: 'main' | 'supplementary' | 'detail';
  // main: 主页（锚点）
  // supplementary: 补充页（额外图片）
  // detail: 详情页（价格、面积等）
}

/**
 * 边界标记
 */
export interface BoundaryMarkers {
  isSectionStart: boolean;      // 是否为章节起始（如 "FLOOR PLANS" 标题页）
  isSectionEnd: boolean;        // 是否为章节结束
  isUnitStart: boolean;         // 是否为户型起始
  isUnitEnd: boolean;           // 是否为户型结束
  startMarkerText?: string;     // 起始标记文字（如 "Type A - 2 Bedroom"）
  endMarkerText?: string;       // 结束标记文字
}

/**
 * 页面内容分析
 */
export interface PageContent {
  textDensity: 'none' | 'sparse' | 'medium' | 'dense';  // 文字密度
  hasTable: boolean;            // 是否有表格
  hasDiagram: boolean;          // 是否有图表
  hasMarketingText: boolean;    // 是否有营销文案
  marketingTexts?: string[];    // 提取的营销文案
}

/**
 * 页面元数据（AI生成）
 * 
 * 这是整个系统的核心数据结构
 * 由AI分析每页后生成，包含页面的所有标记信息
 */
export interface PageMetadata {
  // ============ 基本信息 ============
  pageNumber: number;           // 全局页码（跨PDF唯一）
  pdfSource: string;            // 源PDF文件名
  chunkIndex: number;           // 所属chunk索引
  
  // ============ AI分类 ============
  pageType: PageType;           // 主要类型
  subTypes: PageSubType[];      // 次要类型（可多个）
  confidence: number;           // AI分类置信度 (0-1)
  
  // ============ 内容分析 ============
  content: PageContent;
  
  // ============ 图片信息 ============
  images: PageImage[];          // 该页所有图片
  
  // ============ 户型信息（如果是户型页）============
  unitInfo?: UnitPageInfo;      // 户型相关信息
  
  // ============ 配套设施信息（如果是amenities页）⭐ ============
  amenitiesData?: {
    amenities: string[];        // 提取的设施列表
  };
  
  // ============ 项目信息（如果是project info页）⭐ ============
  projectInfoData?: {
    projectName?: string;
    developer?: string;
    address?: string;
    area?: string;
    launchDate?: string;
    completionDate?: string;
    handoverDate?: string;
    constructionProgress?: number;
    description?: string;
  };
  
  // ============ 付款计划信息（如果是payment plan页）⭐ ============
  paymentPlanData?: {
    name?: string;
    milestones: Array<{
      milestone: string;
      percentage: number;
      stage?: string;
    }>;
  };
  
  // ============ 边界标记 ============
  boundaryMarkers: BoundaryMarkers;
}
