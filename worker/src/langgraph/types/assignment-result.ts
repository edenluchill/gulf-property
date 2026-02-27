/**
 * 图片分配结果类型定义
 */

import { PageImage } from './page-metadata';

/**
 * 户型边界
 * 
 * 记录一个户型在PDF中的页面范围
 */
export interface UnitBoundary {
  unitTypeName: string;         // 户型名称
  startPage: number;            // 起始页码（全局）
  endPage: number;              // 结束页码（全局）
  pageCount: number;            // 页数
  pdfSources: string[];         // 跨越的PDF文件（支持多PDF场景）
}

/**
 * 户型图片分配
 *
 * 一个户型的所有图片（按类别分组）
 */
export interface UnitImageAssignment {
  unitTypeName: string;         // 户型名称
  unitCategory?: string;        // 户型分类 (Studio, 1BR, 2BR, etc.)
  building?: string;            // Building/Tower (用于价格匹配)

  // 图片分组（按类别）
  floorPlanImages: PageImage[];    // 平面图
  renderingImages: PageImage[];    // 外观渲染图
  interiorImages: PageImage[];     // 内设图
  balconyImages: PageImage[];      // 阳台图
  allImages: PageImage[];          // 所有图片

  // 价格信息（从价格表映射）⭐
  price?: number;                  // 总价 (AED)
  pricePerSqft?: number;           // 单价 (AED/sqft)
  priceMatchType?: 'exact' | 'normalized' | 'building_category' | 'category_only';  // 匹配方式
  priceConfidence?: number;        // 价格匹配置信度

  // 来源信息（支持多PDF场景）
  pdfSources: string[];         // 图片来源的PDF文件列表

  // 元数据
  pageRange?: {
    start: number;
    end: number;
  };

  // ⭐ 来源页码追踪（用于调试和验证）
  sourcePages?: number[];          // 贡献图片的页码列表
}

/**
 * 项目图片分组
 */
export interface ProjectImages {
  coverImages: PageImage[];        // 封面图
  aerialImages: PageImage[];       // 航拍图
  locationMaps: PageImage[];       // 位置地图
  masterPlanImages: PageImage[];   // 总平面图
  amenityImages: PageImage[];      // 配套设施图
  renderingImages: PageImage[];    // 项目渲染图
}

/**
 * 价格条目（从价格表提取）
 */
export interface PricingEntry {
  unitTypeName?: string;
  unitCategory?: string;
  building?: string;
  price: number;
  pricePerSqft?: number;
  area?: number;
  isStartingFrom?: boolean;
  sourcePageNumber: number;
}

/**
 * 图片分配结果
 *
 * 整个PDF处理后的最终输出
 */
export interface AssignmentResult {
  units: UnitImageAssignment[];    // 户型分配结果
  projectImages: ProjectImages;    // 项目整体图片
  paymentPlans?: any[];            // 付款计划
  projectInfo?: any;               // ⭐ 项目基本信息
  amenities?: string[];            // ⭐ 配套设施列表
  pricing?: PricingEntry[];        // ⭐ 原始价格数据（用于调试）

  // 统计信息
  totalPages: number;              // 总页数
  totalPdfs: number;               // 总PDF数
  anchorPagesFound: number;        // 找到的锚点页数量
  unitsWithPrices?: number;        // ⭐ 有价格的户型数量

  // 调试信息
  boundaries?: UnitBoundary[];     // 识别的边界（可选，用于调试）
  processingTime?: number;         // 处理时间（ms）
}

/**
 * Chunk处理结果
 */
export interface ChunkProcessingResult {
  success: boolean;
  chunkIndex: number;
  pageMetadataList: import('./page-metadata').PageMetadata[];
  errors?: string[];
  processingTime?: number;
}

/**
 * 批处理结果
 */
export interface BatchProcessingResult {
  success: boolean;
  assignmentResult: AssignmentResult;
  allErrors: string[];
  allWarnings: string[];
  totalProcessingTime: number;
}
