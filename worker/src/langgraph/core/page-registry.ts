/**
 * Per-Job Page Registry
 *
 * 核心机制：
 * 1. 每个Job有独立的PageRegistry实例（支持并发）
 * 2. 增量插入（Node.js单线程，无需额外锁）
 * 3. 每次插入触发重新计算
 * 4. 实时发送更新给前端
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
import { AssignmentResult, UnitImageAssignment } from '../types/assignment-result';
import { scanUnitBoundaries } from '../algorithms/scan-boundaries';
import { assignImagesByBoundaries } from '../algorithms/assign-images';
import { mergeSameNameUnits } from '../algorithms/merge-units';
import { extractProjectImages } from '../algorithms/extract-project-images';
import { mergeProjectInfo } from '../agents/project-info-extractor.agent';
import { findPriceForUnit, inferCategoryFromUnitName } from '../utils/unit-name-matcher';

/**
 * Pricing entry from pricing table pages
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
 * Serializable state for checkpoint/restore
 */
export interface PageRegistryState {
  pages: PageMetadata[];
  extractedPaymentPlans?: any[];
  extractedProjectInfo?: any;
  extractedAmenities?: string[];
  extractedPricing?: PricingEntry[];
  buildingContext?: Map<number, string>;  // pageNumber → building
}

/**
 * PageRegistry - Per-job instance for page management
 */
export class PageRegistry {
  private pages: PageMetadata[] = [];
  private isProcessing = false;
  private onUpdateCallback?: (result: AssignmentResult) => void;

  // Performance optimization: Cache extracted results
  private extractedPaymentPlans?: any[];
  private extractedProjectInfo?: any;
  private extractedAmenities?: string[];
  private extractedPricing: PricingEntry[] = [];

  // Building context tracking (for price mapping)
  private buildingContext: Map<number, string> = new Map();  // pageNumber → building
  private currentBuilding?: string;  // Current building as pages are processed

  constructor(private jobId: string) {
    console.log(`🔄 PageRegistry created for job ${jobId}`);
  }

  /**
   * 重置Registry
   */
  reset(): void {
    this.pages = [];
    this.onUpdateCallback = undefined;
    this.extractedPaymentPlans = undefined;
    this.extractedProjectInfo = undefined;
    this.extractedAmenities = undefined;
    this.extractedPricing = [];
    this.buildingContext.clear();
    this.currentBuilding = undefined;
    console.log(`🔄 PageRegistry reset for job ${this.jobId}`);
  }

  /**
   * 设置更新回调（用于实时通知前端）
   */
  setUpdateCallback(callback: (result: AssignmentResult) => void): void {
    this.onUpdateCallback = callback;
    console.log(`✓ Update callback registered for job ${this.jobId}`);
  }

  /**
   * 增量插入新页面
   */
  async insertPages(newPages: PageMetadata[]): Promise<void> {
    if (this.isProcessing) {
      console.warn(`⚠️  [${this.jobId}] Another insertion in progress, queuing...`);
      await new Promise(resolve => setTimeout(resolve, 10));
      return this.insertPages(newPages);
    }

    this.isProcessing = true;

    try {
      let insertedCount = 0;
      newPages.forEach(page => {
        const existingIndex = this.pages.findIndex(p =>
          p.pageNumber === page.pageNumber && p.pdfSource === page.pdfSource
        );
        if (existingIndex >= 0) {
          console.warn(`⚠️  [${this.jobId}] Page ${page.pageNumber} from ${page.pdfSource} already exists, skipping`);
          return;
        }

        this.pages.push(page);
        insertedCount++;
        console.log(`   [${this.jobId}] ✓ Inserted page ${page.pageNumber} (${page.pageType}, ${page.pdfSource})`);

        // Track building context from section titles
        if (page.boundaryMarkers.isSectionStart && page.boundaryMarkers.startMarkerText) {
          const buildingName = extractBuildingFromText(page.boundaryMarkers.startMarkerText);
          if (buildingName) {
            this.currentBuilding = buildingName;
            console.log(`   [${this.jobId}] 🏢 Building context updated: ${buildingName}`);
          }
        }

        // Track building context for this page
        if (this.currentBuilding) {
          this.buildingContext.set(page.pageNumber, this.currentBuilding);
        }

        // Extract pricing from pricing table pages
        if (page.pricingData && page.pricingData.entries.length > 0) {
          const building = page.pricingData.pageBuilding || this.currentBuilding;
          for (const entry of page.pricingData.entries) {
            this.extractedPricing.push({
              ...entry,
              building: entry.building || building,
              sourcePageNumber: page.pageNumber,
            });
          }
          console.log(`   [${this.jobId}] 💵 Added ${page.pricingData.entries.length} pricing entries`);
        }
      });

      if (insertedCount === 0) {
        console.log(`   [${this.jobId}] ℹ️  No new pages inserted`);
        return;
      }

      // Sort by PDF source then page number
      this.pages.sort((a, b) => {
        if (a.pdfSource !== b.pdfSource) {
          return a.pdfSource.localeCompare(b.pdfSource);
        }
        return a.pageNumber - b.pageNumber;
      });

      const startTime = Date.now();
      const assignmentResult = await this.recalculateAssignment();
      const calcTime = Date.now() - startTime;

      console.log(`   [${this.jobId}] 📊 Recalculation completed in ${calcTime}ms`);
      console.log(`   [${this.jobId}] 📄 Total pages: ${this.pages.length}`);
      console.log(`   [${this.jobId}] 🏠 Units found: ${assignmentResult.units.length}`);
      console.log(`   [${this.jobId}] ⚓ Anchors: ${assignmentResult.anchorPagesFound}`);

      if (this.onUpdateCallback) {
        this.onUpdateCallback(assignmentResult);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 重新计算图片分配
   */
  private async recalculateAssignment(): Promise<AssignmentResult> {
    console.log(`\n[${this.jobId}] 🔄 Recalculating image assignment...`);

    const startTime = Date.now();

    const boundaries = scanUnitBoundaries(this.pages);
    console.log(`   [${this.jobId}] ✓ Identified ${boundaries.length} unit boundaries`);

    const assignments = assignImagesByBoundaries(this.pages, boundaries);
    console.log(`   [${this.jobId}] ✓ Assigned images to ${assignments.length} units`);

    const mergedUnits = mergeSameNameUnits(assignments);
    const mergedCount = assignments.length - mergedUnits.length;
    if (mergedCount > 0) {
      console.log(`   [${this.jobId}] ✓ Merged ${mergedCount} duplicate unit types`);
    }

    // ⭐ Merge prices into units
    const unitsWithPrices = this.mergePricesIntoUnits(mergedUnits);
    const pricedCount = unitsWithPrices.filter(u => u.price).length;
    if (pricedCount > 0) {
      console.log(`   [${this.jobId}] 💵 Mapped prices to ${pricedCount}/${unitsWithPrices.length} units`);
    }

    const projectImages = extractProjectImages(this.pages, boundaries);
    console.log(`   [${this.jobId}] ✓ Extracted project images`);

    const processingTime = Date.now() - startTime;
    const uniquePdfs = new Set(this.pages.map(p => p.pdfSource));

    return {
      units: unitsWithPrices,
      projectImages,
      paymentPlans: this.extractedPaymentPlans,
      projectInfo: this.extractedProjectInfo,
      amenities: this.extractedAmenities,
      pricing: this.extractedPricing.length > 0 ? this.extractedPricing : undefined,
      totalPages: this.pages.length,
      totalPdfs: uniquePdfs.size,
      anchorPagesFound: boundaries.length,
      unitsWithPrices: pricedCount,
      boundaries,
      processingTime,
    };
  }

  /**
   * Merge prices from pricing tables into unit assignments
   */
  private mergePricesIntoUnits(units: UnitImageAssignment[]): UnitImageAssignment[] {
    if (this.extractedPricing.length === 0) {
      return units;
    }

    console.log(`   [${this.jobId}] 🔍 Matching ${this.extractedPricing.length} pricing entries to ${units.length} units...`);

    // Debug: Show available pricing entries
    const pricingByCategory = new Map<string, number>();
    for (const entry of this.extractedPricing) {
      const key = entry.unitCategory || entry.unitTypeName || 'unknown';
      pricingByCategory.set(key, (pricingByCategory.get(key) || 0) + 1);
    }
    console.log(`   [${this.jobId}] 📊 Pricing categories: ${Array.from(pricingByCategory.entries()).map(([k, v]) => `${k}(${v})`).join(', ')}`);

    let matchedCount = 0;
    let unmatchedUnits: string[] = [];

    const result = units.map(unit => {
      // Get unit category (from metadata or inferred from name)
      const unitCategory = unit.unitCategory || inferCategoryFromUnitName(unit.unitTypeName);

      // Get building context for this unit (from first page in range)
      const building = unit.building || (unit.pageRange ? this.buildingContext.get(unit.pageRange.start) : undefined);

      // Debug: Show what we're trying to match
      console.log(`   [${this.jobId}]   🔎 Matching "${unit.unitTypeName}" category=${unitCategory} building=${building || 'none'}`);

      // Find matching price
      const priceResult = findPriceForUnit(
        unit.unitTypeName,
        unitCategory,
        building,
        this.extractedPricing
      );

      if (priceResult) {
        matchedCount++;
        console.log(`   [${this.jobId}]   💰 ${unit.unitTypeName} (${unitCategory}) → ${priceResult.price.toLocaleString()} AED (${priceResult.matchType})`);

        return {
          ...unit,
          unitCategory,
          building,
          price: priceResult.price,
          pricePerSqft: priceResult.pricePerSqft,
          priceMatchType: priceResult.matchType,
          priceConfidence: priceResult.confidence,
        };
      }

      unmatchedUnits.push(`${unit.unitTypeName}(${unitCategory || 'no-cat'})`);
      return {
        ...unit,
        unitCategory,
        building,
      };
    });

    if (unmatchedUnits.length > 0) {
      console.log(`   [${this.jobId}] ⚠️  Unmatched units: ${unmatchedUnits.join(', ')}`);
    }
    console.log(`   [${this.jobId}] ✅ Price matching complete: ${matchedCount}/${units.length} matched`);

    return result;
  }

  /**
   * 提取项目级别的数据
   */
  async aggregateProjectData(): Promise<void> {
    console.log(`\n[${this.jobId}] 📊 Aggregating project-level data...`);
    const startTime = Date.now();

    // Amenities
    if (!this.extractedAmenities) {
      const amenitiesPages = this.pages.filter(p => p.amenitiesData && p.amenitiesData.amenities.length > 0);
      const allAmenities = amenitiesPages.flatMap(p => p.amenitiesData!.amenities);
      const totalCount = allAmenities.length;

      const { deduplicateAmenitiesWithAI } = await import('../agents/amenity-extractor.agent');
      this.extractedAmenities = await deduplicateAmenitiesWithAI(allAmenities);

      console.log(`   [${this.jobId}] 🏊 Aggregated ${this.extractedAmenities.length} amenities (${totalCount} → ${this.extractedAmenities.length})`);
    }

    // Project info
    if (!this.extractedProjectInfo) {
      const projectInfoPages = this.pages.filter(p => p.projectInfoData);
      if (projectInfoPages.length > 0) {
        const infos = projectInfoPages.map(p => p.projectInfoData!);
        this.extractedProjectInfo = mergeProjectInfo(infos);
        console.log(`   [${this.jobId}] 🏗️  Aggregated project info from ${projectInfoPages.length} pages`);
      }
    }

    // Payment plans
    if (!this.extractedPaymentPlans) {
      const paymentPages = this.pages.filter(p => p.paymentPlanData);
      if (paymentPages.length > 0) {
        this.extractedPaymentPlans = paymentPages.map(p => p.paymentPlanData!);
        console.log(`   [${this.jobId}] 💰 Aggregated ${this.extractedPaymentPlans.length} payment plans`);
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`\n[${this.jobId}] ✅ Aggregation complete in ${processingTime}ms`);
  }

  getAllPages(): PageMetadata[] {
    return [...this.pages];
  }

  getAnchorPages(): PageMetadata[] {
    return this.pages.filter(p => p.pageType === 'unit_anchor');
  }

  getPaymentPlanPages(): PageMetadata[] {
    return this.pages.filter(p => p.pageType === PageType.PAYMENT_PLAN);
  }

  getProjectInfoPages(): PageMetadata[] {
    return this.pages.filter(p =>
      p.pageType === PageType.PROJECT_COVER ||
      p.pageType === PageType.PROJECT_OVERVIEW ||
      p.pageType === PageType.PROJECT_SUMMARY ||
      p.pageType === PageType.SECTION_TITLE ||
      p.pageType === PageType.PROJECT_RENDERING ||
      p.pageType === PageType.PROJECT_AERIAL
    );
  }

  getAmenityPages(): PageMetadata[] {
    return this.pages.filter(p =>
      p.pageType === PageType.AMENITIES_LIST ||
      p.pageType === PageType.AMENITIES_IMAGES ||
      p.pageType === PageType.TOWER_CHARACTERISTICS ||
      p.pageType === PageType.PROJECT_OVERVIEW ||
      p.pageType === PageType.PROJECT_SUMMARY
    );
  }

  getTowerCharacteristicsPages(): PageMetadata[] {
    return this.pages.filter(p => p.pageType === PageType.TOWER_CHARACTERISTICS);
  }

  getPagesByPdf(pdfSource: string): PageMetadata[] {
    return this.pages.filter(p => p.pdfSource === pdfSource);
  }

  async getFinalResult(): Promise<AssignmentResult> {
    return await this.recalculateAssignment();
  }

  getStats() {
    const pdfs = new Set(this.pages.map(p => p.pdfSource));
    const anchors = this.pages.filter(p => p.pageType === 'unit_anchor');

    return {
      totalPages: this.pages.length,
      totalPdfs: pdfs.size,
      anchorPages: anchors.length,
      pageTypes: this.getPageTypeDistribution(),
    };
  }

  private getPageTypeDistribution() {
    const distribution = new Map<string, number>();
    this.pages.forEach(page => {
      const count = distribution.get(page.pageType) || 0;
      distribution.set(page.pageType, count + 1);
    });
    return Object.fromEntries(distribution);
  }

  /**
   * Export state for checkpoint
   */
  exportState(): PageRegistryState {
    return {
      pages: [...this.pages],
      extractedPaymentPlans: this.extractedPaymentPlans,
      extractedProjectInfo: this.extractedProjectInfo,
      extractedAmenities: this.extractedAmenities,
      extractedPricing: [...this.extractedPricing],
      buildingContext: new Map(this.buildingContext),
    };
  }

  /**
   * Import state from checkpoint
   */
  importState(state: PageRegistryState): void {
    this.pages = [...state.pages];
    this.extractedPaymentPlans = state.extractedPaymentPlans;
    this.extractedProjectInfo = state.extractedProjectInfo;
    this.extractedAmenities = state.extractedAmenities;
    this.extractedPricing = state.extractedPricing ? [...state.extractedPricing] : [];
    this.buildingContext = state.buildingContext ? new Map(state.buildingContext) : new Map();
    console.log(`[${this.jobId}] 📥 Imported state: ${this.pages.length} pages, ${this.extractedPricing.length} pricing entries`);
  }

  /**
   * Get pricing entries
   */
  getPricingEntries(): PricingEntry[] {
    return [...this.extractedPricing];
  }

  /**
   * Get pricing table pages
   */
  getPricingTablePages(): PageMetadata[] {
    return this.pages.filter(p => p.pageType === PageType.PRICING_TABLE);
  }
}

/**
 * PageRegistryManager - Manages per-job PageRegistry instances
 */
export class PageRegistryManager {
  private static registries: Map<string, PageRegistry> = new Map();

  /**
   * Get or create a PageRegistry for a job
   */
  static get(jobId: string): PageRegistry {
    let registry = this.registries.get(jobId);
    if (!registry) {
      registry = new PageRegistry(jobId);
      this.registries.set(jobId, registry);
    }
    return registry;
  }

  /**
   * Check if a registry exists for a job
   */
  static has(jobId: string): boolean {
    return this.registries.has(jobId);
  }

  /**
   * Delete a registry for a job (cleanup)
   */
  static delete(jobId: string): void {
    const registry = this.registries.get(jobId);
    if (registry) {
      registry.reset();
      this.registries.delete(jobId);
      console.log(`🧹 PageRegistry deleted for job ${jobId}`);
    }
  }

  /**
   * Export state for a job (for checkpoint)
   */
  static exportState(jobId: string): PageRegistryState | null {
    const registry = this.registries.get(jobId);
    return registry ? registry.exportState() : null;
  }

  /**
   * Import state for a job (for resume)
   */
  static importState(jobId: string, state: PageRegistryState): void {
    const registry = this.get(jobId);
    registry.importState(state);
  }

  /**
   * Get all active job IDs
   */
  static getActiveJobs(): string[] {
    return Array.from(this.registries.keys());
  }

  /**
   * Clear all registries
   */
  static clear(): void {
    for (const [, registry] of this.registries) {
      registry.reset();
    }
    this.registries.clear();
    console.log('🧹 All PageRegistries cleared');
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Extract building name from section title text
 *
 * Examples:
 * - "TOWER A" → "Tower A"
 * - "Crestlane 4" → "Crestlane 4"
 * - "Building B Floor Plans" → "Building B"
 * - "FLOOR PLANS" → null (not a building name)
 */
function extractBuildingFromText(text: string): string | null {
  if (!text) return null;

  const normalized = text.trim();

  // Pattern: Tower X
  const towerMatch = normalized.match(/tower\s*([a-z0-9]+)/i);
  if (towerMatch) {
    return `Tower ${towerMatch[1].toUpperCase()}`;
  }

  // Pattern: Building X
  const buildingMatch = normalized.match(/building\s*([a-z0-9]+)/i);
  if (buildingMatch) {
    return `Building ${buildingMatch[1].toUpperCase()}`;
  }

  // Pattern: Name + Number (e.g., "Crestlane 4", "Marina Vista 2")
  const nameNumberMatch = normalized.match(/^([a-z]+)\s*(\d+)$/i);
  if (nameNumberMatch) {
    return `${nameNumberMatch[1]} ${nameNumberMatch[2]}`;
  }

  // Pattern: Phase X
  const phaseMatch = normalized.match(/phase\s*([a-z0-9]+)/i);
  if (phaseMatch) {
    return `Phase ${phaseMatch[1].toUpperCase()}`;
  }

  // Skip generic section titles
  const genericTitles = [
    'floor plans', 'floorplans', 'unit types', 'amenities',
    'payment plan', 'location', 'features', 'overview', 'specifications',
    'pricing', 'price', 'prices', 'price list', 'unit mix', 'availability'
  ];
  if (genericTitles.some(t => normalized.toLowerCase().includes(t))) {
    return null;
  }

  // If it's a short capitalized title (likely a building name)
  if (normalized.length <= 20 && /^[A-Z0-9\s]+$/.test(normalized)) {
    // Title case it
    return normalized.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  return null;
}
