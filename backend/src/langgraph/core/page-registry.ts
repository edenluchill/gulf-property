/**
 * 全局页面注册表
 * 
 * 核心机制：
 * 1. 增量插入（Node.js单线程，无需额外锁）
 * 2. 每次插入触发重新计算
 * 3. 实时发送更新给前端
 * 
 * 支持多PDF场景：
 * - 自动合并同名户型
 * - 追溯图片来源
 * 
 * 注意：
 * - Node.js单线程，数组操作是原子的
 * - 不需要async-lock（除非回调中有长时间异步操作）
 */

import { PageMetadata, PageType } from '../types/page-metadata';
import { AssignmentResult, UnitBoundary } from '../types/assignment-result';
import { scanUnitBoundaries } from '../algorithms/scan-boundaries';
import { assignImagesByBoundaries } from '../algorithms/assign-images';
import { mergeSameNameUnits } from '../algorithms/merge-units';
import { extractProjectImages } from '../algorithms/extract-project-images';
import { mergeProjectInfo } from '../agents/project-info-extractor.agent';

/**
 * PageRegistry - 全局单例
 */
export class PageRegistry {
  private static pages: PageMetadata[] = [];
  private static isProcessing = false;  // 简单的处理标志
  private static onUpdateCallback?: (result: AssignmentResult) => void;
  
  // ⭐ Performance optimization: Cache extracted results to avoid re-processing
  private static extractedPaymentPlans?: any[];
  private static extractedProjectInfo?: any;
  private static extractedAmenities?: string[];
  
  /**
   * 重置Registry（新任务开始时调用）
   */
  static reset(): void {
    this.pages = [];
    this.onUpdateCallback = undefined;
    // ⭐ Reset caches
    this.extractedPaymentPlans = undefined;
    this.extractedProjectInfo = undefined;
    this.extractedAmenities = undefined;
    console.log('🔄 PageRegistry reset');
  }
  
  /**
   * 设置更新回调（用于实时通知前端）
   */
  static setUpdateCallback(callback: (result: AssignmentResult) => void): void {
    this.onUpdateCallback = callback;
    console.log('✓ Update callback registered');
  }
  
  /**
   * 增量插入新页面
   * 
   * 关键：
   * - 只插入新pages，不修改已有pages
   * - 插入后立即触发重新计算
   * - 顺序无关（Chunk 3可能先于Chunk 1完成）
   * 
   * 注意：
   * - Node.js单线程，数组操作是原子的
   * - 使用简单的处理标志避免重入
   */
  static async insertPages(newPages: PageMetadata[]): Promise<void> {
    // 简单的重入检查（可选）
    if (this.isProcessing) {
      console.warn('⚠️  Another insertion in progress, queuing...');
      // 等待一小段时间后重试
      await new Promise(resolve => setTimeout(resolve, 10));
      return this.insertPages(newPages);
    }
    
    this.isProcessing = true;
    
    try {
      // 1. 插入新页面
      let insertedCount = 0;
      newPages.forEach(page => {
        // ⭐ 检查是否已存在（同时检查pageNumber和pdfSource，避免多PDF页码冲突）
        const existingIndex = this.pages.findIndex(p => 
          p.pageNumber === page.pageNumber && p.pdfSource === page.pdfSource
        );
        if (existingIndex >= 0) {
          console.warn(`⚠️  Page ${page.pageNumber} from ${page.pdfSource} already exists, skipping`);
          return;
        }
        
        this.pages.push(page);
        insertedCount++;
        console.log(`   ✓ Inserted page ${page.pageNumber} (${page.pageType}, ${page.pdfSource})`);
      });
      
      if (insertedCount === 0) {
        console.log('   ℹ️  No new pages inserted');
        return;
      }
      
      // 2. 排序（先按pdfSource，再按页码，确保多PDF场景下顺序正确）
      this.pages.sort((a, b) => {
        if (a.pdfSource !== b.pdfSource) {
          return a.pdfSource.localeCompare(b.pdfSource);
        }
        return a.pageNumber - b.pageNumber;
      });
      
      // 3. 立即重新计算图片分配（现在是async）
      const startTime = Date.now();
      const assignmentResult = await this.recalculateAssignment();
      const calcTime = Date.now() - startTime;
      
      console.log(`   📊 Recalculation completed in ${calcTime}ms`);
      console.log(`   📄 Total pages: ${this.pages.length}`);
      console.log(`   🏠 Units found: ${assignmentResult.units.length}`);
      console.log(`   ⚓ Anchors: ${assignmentResult.anchorPagesFound}`);
      console.log(`   💰 Payment plans: ${assignmentResult.paymentPlans?.length || 0}`);
      
      // 4. 实时通知前端（非阻塞）
      if (this.onUpdateCallback) {
        // 不等待回调完成，避免阻塞
        this.onUpdateCallback(assignmentResult);
      }
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * 重新计算图片分配
   * 
   * 每次插入新pages后自动调用
   * 即使图片页在anchor前完成，也能后续正确分配
   * 
   * ⭐ 现在是 async：调用专门的 extractors 提取详细信息
   */
  private static async recalculateAssignment(): Promise<AssignmentResult> {
    console.log('\n🔄 Recalculating image assignment...');
    
    const startTime = Date.now();
    
    // 1. 边界扫描 → 识别每个户型的页面范围
    const boundaries = scanUnitBoundaries(this.pages);
    console.log(`   ✓ Identified ${boundaries.length} unit boundaries`);
    
    // 2. 图片分配 → 范围内的图片归属该户型
    const assignments = assignImagesByBoundaries(this.pages, boundaries);
    console.log(`   ✓ Assigned images to ${assignments.length} units`);
    
    // 3. ⭐ 同名合并 → 合并跨PDF的同名户型
    const mergedUnits = mergeSameNameUnits(assignments);
    const mergedCount = assignments.length - mergedUnits.length;
    if (mergedCount > 0) {
      console.log(`   ✓ Merged ${mergedCount} duplicate unit types (multi-PDF scenario)`);
    }
    
    // 4. 提取项目图片（不在任何户型边界内的图片）
    const projectImages = extractProjectImages(this.pages, boundaries);
    console.log(`   ✓ Extracted project images`);
    
    // ============ ⭐ AI提取已移到extractProjectData()，只在最后调用一次 ============
    
    const processingTime = Date.now() - startTime;
    
    // 统计PDF数量
    const uniquePdfs = new Set(this.pages.map(p => p.pdfSource));
    
    return {
      units: mergedUnits,
      projectImages,
      paymentPlans: this.extractedPaymentPlans,      // ⭐ 使用缓存的结果
      projectInfo: this.extractedProjectInfo,        // ⭐ 使用缓存的结果
      amenities: this.extractedAmenities,            // ⭐ 使用缓存的结果
      totalPages: this.pages.length,
      totalPdfs: uniquePdfs.size,
      anchorPagesFound: boundaries.length,
      boundaries,
      processingTime,
    };
  }
  
  /**
   * ⭐ 提取项目级别的数据（只在所有batches完成后调用一次）
   * 
   * 包括：
   * - Payment Plans
   * - Amenities  
   * - Project Info
   */
  static async aggregateProjectData(): Promise<void> {
    console.log('\n📊 Aggregating project-level data from analyzed pages...');
    const startTime = Date.now();
    
    // 1. 汇总配套设施（使用AI智能去重）
    if (!this.extractedAmenities) {
      const amenitiesPages = this.pages.filter(p => p.amenitiesData && p.amenitiesData.amenities.length > 0);
      const allAmenities = amenitiesPages.flatMap(p => p.amenitiesData!.amenities);
      const totalCount = allAmenities.length;
      
      // ⭐ 使用AI进行智能去重和规范化
      const { deduplicateAmenitiesWithAI } = await import('../agents/amenity-extractor.agent');
      this.extractedAmenities = await deduplicateAmenitiesWithAI(allAmenities);
      
      console.log(`   🏊 Aggregated ${this.extractedAmenities.length} unique amenities from ${amenitiesPages.length} pages (${totalCount} total → ${this.extractedAmenities.length} after AI dedup)`);
    }
    
    // 2. 汇总项目基本信息（从PageMetadata中读取，无AI调用）
    if (!this.extractedProjectInfo) {
      const projectInfoPages = this.pages.filter(p => p.projectInfoData);
      if (projectInfoPages.length > 0) {
        const infos = projectInfoPages.map(p => p.projectInfoData!);
        this.extractedProjectInfo = mergeProjectInfo(infos);
        console.log(`   🏗️  Aggregated project info from ${projectInfoPages.length} pages:`, Object.keys(this.extractedProjectInfo).join(', '));
      }
    }
    
    // 3. 汇总付款计划（从PageMetadata中读取，无AI调用）
    if (!this.extractedPaymentPlans) {
      const paymentPages = this.pages.filter(p => p.paymentPlanData);
      if (paymentPages.length > 0) {
        this.extractedPaymentPlans = paymentPages.map(p => p.paymentPlanData!);
        console.log(`   💰 Aggregated ${this.extractedPaymentPlans.length} payment plans`);
      }
    }
    
    const processingTime = Date.now() - startTime;
    
    console.log(`\n✅ Project data aggregation complete in ${processingTime}ms (pure logic, no AI calls)`);
    console.log(`   💰 Payment plans: ${this.extractedPaymentPlans?.length || 0}`);
    console.log(`   🏊 Amenities: ${this.extractedAmenities?.length || 0}`);
    console.log(`   🏗️  Project info: ${this.extractedProjectInfo ? Object.keys(this.extractedProjectInfo).join(', ') : 'none'}`);
  }
  
  /**
   * 获取所有页面（已排序）
   */
  static getAllPages(): PageMetadata[] {
    return [...this.pages];  // 返回副本，避免外部修改
  }
  
  /**
   * 获取锚点页面
   */
  static getAnchorPages(): PageMetadata[] {
    return this.pages.filter(p => p.pageType === 'unit_anchor');
  }
  
  /**
   * 获取Payment Plan页面
   */
  static getPaymentPlanPages(): PageMetadata[] {
    return this.pages.filter(p => p.pageType === PageType.PAYMENT_PLAN);
  }
  
  /**
   * 获取项目信息页面
   * 
   * ⭐ OPTIMIZED: Expanded to include more page types for better description extraction
   */
  static getProjectInfoPages(): PageMetadata[] {
    return this.pages.filter(p => 
      p.pageType === PageType.PROJECT_COVER ||
      p.pageType === PageType.PROJECT_OVERVIEW ||
      p.pageType === PageType.PROJECT_SUMMARY ||
      p.pageType === PageType.SECTION_TITLE ||      // ⭐ May contain intro text
      p.pageType === PageType.PROJECT_RENDERING ||  // ⭐ Often has marketing text
      p.pageType === PageType.PROJECT_AERIAL        // ⭐ May have project description
    );
  }
  
  /**
   * 获取配套设施页面
   */
  static getAmenityPages(): PageMetadata[] {
    return this.pages.filter(p => 
      p.pageType === PageType.AMENITIES_LIST ||
      p.pageType === PageType.AMENITIES_IMAGES ||
      p.pageType === PageType.TOWER_CHARACTERISTICS ||
      p.pageType === PageType.PROJECT_OVERVIEW ||
      p.pageType === PageType.PROJECT_SUMMARY
    );
  }
  
  /**
   * 获取Tower特性页面
   */
  static getTowerCharacteristicsPages(): PageMetadata[] {
    return this.pages.filter(p => p.pageType === PageType.TOWER_CHARACTERISTICS);
  }
  
  /**
   * 按PDF源筛选
   */
  static getPagesByPdf(pdfSource: string): PageMetadata[] {
    return this.pages.filter(p => p.pdfSource === pdfSource);
  }
  
  /**
   * 获取最终结果
   */
  static async getFinalResult(): Promise<AssignmentResult> {
    return await this.recalculateAssignment();
  }
  
  /**
   * 获取统计信息
   */
  static getStats() {
    const pdfs = new Set(this.pages.map(p => p.pdfSource));
    const anchors = this.pages.filter(p => p.pageType === 'unit_anchor');
    
    return {
      totalPages: this.pages.length,
      totalPdfs: pdfs.size,
      anchorPages: anchors.length,
      pageTypes: this.getPageTypeDistribution(),
    };
  }
  
  private static getPageTypeDistribution() {
    const distribution = new Map<string, number>();
    this.pages.forEach(page => {
      const count = distribution.get(page.pageType) || 0;
      distribution.set(page.pageType, count + 1);
    });
    return Object.fromEntries(distribution);
  }
}
