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

从页面中提取所有付款阶段（milestones）和百分比。

常见的付款阶段：
- On Booking / Down Payment: 预定/首付
- On Foundation: 地基完成
- During Construction: 建设期间
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
      "description": "Down payment"
    },
    {
      "milestone": "April 2026",
      "percentage": 10,
      "date": "2026-04-01"
    },
    {
      "milestone": "On Handover",
      "percentage": 25,
      "date": "June 2028"
    }
  ],
  "totalPercentage": 100,
  "description": "Flexible payment plan over construction period"
}

## 注意事项

1. 准确提取所有百分比（必须加起来接近100%）
2. 提取日期信息（如果有）
3. 阶段名称保持原文（英文）
4. 如果是分期付款，按时间顺序排列

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
