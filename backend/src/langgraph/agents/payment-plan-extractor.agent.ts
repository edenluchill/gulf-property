/**
 * Payment Plan提取Agent
 * 
 * 从payment plan页面提取结构化的付款计划信息
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { readFileSync } from 'fs';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export interface PaymentMilestone {
  milestone: string;        // 阶段名称（如 "On Booking", "On Handover"）
  percentage: number;       // 付款百分比
  date?: string;            // 日期（如果有）
  description?: string;     // 描述
  intervalMonths?: number;  // 距离上一个milestone的月数（AI提取或自动计算）
  intervalDescription?: string;  // 间隔描述（如 "3个月后", "交房时"）
}

export interface PaymentPlan {
  milestones: PaymentMilestone[];
  totalPercentage: number;  // 总计应为100%
  description?: string;     // 付款计划描述
}

/**
 * 从payment plan页面提取付款计划
 */
export async function extractPaymentPlan(
  imagePath: string,
  pageNumber: number
): Promise<PaymentPlan | null> {
  
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });

    const imageBuffer = readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = `你是房地产付款计划分析专家。分析这个付款计划页面。

## 任务：提取结构化的付款计划

从页面中提取所有付款阶段（milestones）、百分比、日期和付款间隔。

常见的付款阶段：
- On Booking / Down Payment: 预定/首付
- On Foundation: 地基完成
- During Construction: 建设期间（可能有多个分期）
- On Completion: 竣工时
- On Handover: 交付时
- Post-Handover: 交付后

## 返回JSON格式

{
  "milestones": [
    {
      "milestone": "On Booking",
      "percentage": 20,
      "date": "2025-01-01",
      "description": "Down payment",
      "intervalMonths": 0,
      "intervalDescription": "At booking"
    },
    {
      "milestone": "3 Months After Booking",
      "percentage": 10,
      "date": "2025-04-01",
      "intervalMonths": 3,
      "intervalDescription": "3 months after booking"
    },
    {
      "milestone": "On Handover",
      "percentage": 70,
      "date": "2028-06-01",
      "intervalMonths": 38,
      "intervalDescription": "On handover"
    }
  ],
  "totalPercentage": 100,
  "description": "Flexible payment plan over construction period"
}

## ⭐ 间隔信息提取重点

1. **intervalMonths**: 从上一个milestone到这个milestone的月数
   - 第一个milestone通常是0（预订时）
   - 计算相邻milestone之间的时间差（月数）
   - 如果PDF有明确标注"3个月后"、"6个月后"，使用该值

2. **intervalDescription**: 间隔的文本描述
   - 保留原文描述（如"3 months after booking", "On handover", "Upon completion"）
   - 如果PDF有明确文字说明，使用原文
   - 如果只有日期，计算后用"X months later"

## 注意事项

1. 准确提取所有百分比（必须加起来接近100%）
2. 提取日期信息（如果有）
3. 阶段名称保持原文（英文）
4. 按时间顺序排列所有milestone
5. 尽量提取或计算intervalMonths和intervalDescription
6. 如果无法确定间隔，可以省略这两个字段

只返回JSON，不要其他文字。`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // ⭐ 直接解析JSON（structured output）
    const parsed = JSON.parse(text);

    console.log(`   ✓ Payment plan extracted: ${parsed.milestones?.length || 0} milestones, ${parsed.totalPercentage}%`);

    return {
      milestones: parsed.milestones || [],
      totalPercentage: parsed.totalPercentage || 0,
      description: parsed.description,
    };

  } catch (error) {
    console.error(`   ✗ Error extracting payment plan from page ${pageNumber}:`, error);
    return null;
  }
}

/**
 * 批量提取付款计划（多个页面）
 */
export async function extractPaymentPlans(
  paymentPlanPages: Array<{ imagePath: string; pageNumber: number }>
): Promise<PaymentPlan[]> {
  
  console.log(`\n💰 Extracting payment plans from ${paymentPlanPages.length} pages...`);
  
  const plans = await Promise.all(
    paymentPlanPages.map(page => 
      extractPaymentPlan(page.imagePath, page.pageNumber)
    )
  );
  
  // 过滤掉null
  const validPlans = plans.filter(p => p !== null) as PaymentPlan[];
  
  console.log(`   ✓ Extracted ${validPlans.length} valid payment plans`);
  
  return validPlans;
}
