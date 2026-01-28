/**
 * Progress Message Internationalization
 * 
 * Maps backend progress codes to localized messages
 * 
 * Usage:
 *   const message = getProgressMessage(event.code, event.data, 'zh-CN');
 */

export type ProgressCode = 
  | 'CONNECTED'
  | 'CHECKING_CACHE'
  | 'GENERATING_IMAGES'
  | 'IMAGES_UPLOADED'
  | 'USING_CACHE'
  | 'SPLITTING_CHUNKS'
  | 'CHUNKS_READY'
  | 'PROCESSING_PAGES'
  | 'ASSIGNMENT_COMPLETE'
  | 'COMPLETE'
  | 'ERROR';

import i18n from '../i18n'

export type LocaleCode = 'en' | 'zh-CN' | 'ar';

// Define message templates with data interpolation
type MessageTemplate = (data?: Record<string, any>) => string;

interface ProgressMessages {
  [key: string]: {
    [locale in LocaleCode]: string | MessageTemplate;
  };
}

const PROGRESS_MESSAGES: ProgressMessages = {
  CONNECTED: {
    'en': '✅ Connected to processing stream',
    'zh-CN': '✅ 已连接到处理流',
    'ar': '✅ متصل بتدفق المعالجة',
  },
  CHECKING_CACHE: {
    'en': '🔍 Checking PDF cache...',
    'zh-CN': '🔍 检查PDF缓存...',
    'ar': '🔍 فحص ذاكرة التخزين المؤقت لـ PDF...',
  },
  GENERATING_IMAGES: {
    'en': '🖼️ Generating all page images in batch...',
    'zh-CN': '🖼️ 批量生成所有页面图片...',
    'ar': '🖼️ إنشاء جميع صور الصفحات دفعة واحدة...',
  },
  IMAGES_UPLOADED: {
    'en': (data) => `✅ ${data?.totalImages || 0} images uploaded to cloud storage`,
    'zh-CN': (data) => `✅ ${data?.totalImages || 0} 张图片已上传到云存储`,
    'ar': (data) => `✅ تم تحميل ${data?.totalImages || 0} صورة إلى التخزين السحابي`,
  },
  USING_CACHE: {
    'en': '⚡ Using cached data (instant response)',
    'zh-CN': '⚡ 使用缓存数据（秒级返回）',
    'ar': '⚡ استخدام البيانات المخزنة مؤقتًا (استجابة فورية)',
  },
  SPLITTING_CHUNKS: {
    'en': (data) => `📦 Splitting documents into ${data?.pagesPerChunk || 5}-page chunks...`,
    'zh-CN': (data) => `📦 正在将所有文档切分成 ${data?.pagesPerChunk || 5} 页小块...`,
    'ar': (data) => `📦 تقسيم المستندات إلى أجزاء من ${data?.pagesPerChunk || 5} صفحات...`,
  },
  CHUNKS_READY: {
    'en': (data) => `✅ Split into ${data?.totalChunks || 0} chunks, starting AI analysis...`,
    'zh-CN': (data) => `✅ 已切分成 ${data?.totalChunks || 0} 个小块，开始AI分析...`,
    'ar': (data) => `✅ تم التقسيم إلى ${data?.totalChunks || 0} جزء، بدء التحليل بالذكاء الاصطناعي...`,
  },
  PROCESSING_PAGES: {
    'en': (data) => `🔄 Processed ${data?.totalPages || 0} pages, found ${data?.anchorPagesFound || 0} unit types`,
    'zh-CN': (data) => `🔄 已处理 ${data?.totalPages || 0} 页，找到 ${data?.anchorPagesFound || 0} 个户型`,
    'ar': (data) => `🔄 تمت معالجة ${data?.totalPages || 0} صفحة، تم العثور على ${data?.anchorPagesFound || 0} أنواع وحدات`,
  },
  ASSIGNMENT_COMPLETE: {
    'en': '✅ Smart assignment complete',
    'zh-CN': '✅ 智能分配完成',
    'ar': '✅ اكتمل التعيين الذكي',
  },
  COMPLETE: {
    'en': '🎉 Processing complete',
    'zh-CN': '🎉 处理完成',
    'ar': '🎉 اكتملت المعالجة',
  },
  ERROR: {
    'en': '❌ Processing failed',
    'zh-CN': '❌ 处理失败',
    'ar': '❌ فشلت المعالجة',
  },
};

/**
 * Get localized progress message
 * 
 * @param code - Progress code from backend
 * @param data - Optional data for message interpolation
 * @param locale - Target locale (default: 'zh-CN')
 * @returns Localized message string
 */
export function getProgressMessage(
  code: ProgressCode,
  data?: Record<string, any>,
  locale: LocaleCode = (i18n.language as LocaleCode) || 'zh-CN'
): string {
  const messageConfig = PROGRESS_MESSAGES[code];
  
  if (!messageConfig) {
    console.warn(`Unknown progress code: ${code}`);
    return code; // Fallback to code itself
  }
  
  const messageOrTemplate = messageConfig[locale] || messageConfig['en'];
  
  if (typeof messageOrTemplate === 'function') {
    return messageOrTemplate(data);
  }
  
  return messageOrTemplate;
}

/**
 * Get all supported locales
 */
export function getSupportedLocales(): LocaleCode[] {
  return ['en', 'zh-CN', 'ar'];
}

/**
 * Example usage in a React component:
 * 
 * ```tsx
 * import { getProgressMessage } from '@/lib/progress-i18n';
 * 
 * function ProgressDisplay({ event, locale = 'zh-CN' }) {
 *   const message = getProgressMessage(event.code, event.data, locale);
 *   
 *   return (
 *     <div>
 *       <div>{message}</div>
 *       <div>Progress: {event.progress}%</div>
 *     </div>
 *   );
 * }
 * ```
 */
