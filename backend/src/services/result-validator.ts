/**
 * Result Validation and Quality Scoring Service
 * 
 * Validates extraction results and provides quality scores
 */

import type { BuildingData } from '../schemas/property.schema';

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100
  issues: ValidationIssue[];
  completeness: {
    overall: number;
    building: number;
    units: number;
    payment: number;
    amenities: number;
  };
}

export interface ValidationIssue {
  severity: 'critical' | 'warning' | 'info';
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Validate and score extraction results
 */
export function validateAndScoreResults(data: Partial<BuildingData>): ValidationResult {
  const issues: ValidationIssue[] = [];
  let totalScore = 0;
  let maxScore = 0;

  // 1. Building Basic Info (30 points)
  maxScore += 30;
  let buildingScore = 0;

  if (data.name && data.name.trim().length > 0) {
    buildingScore += 10;
  } else {
    issues.push({
      severity: 'critical',
      field: 'name',
      message: 'Building name is missing',
      suggestion: 'Check if the PDF has a title page with the project name',
    });
  }

  if (data.developer && data.developer.trim().length > 0) {
    buildingScore += 8;
  } else {
    issues.push({
      severity: 'critical',
      field: 'developer',
      message: 'Developer name is missing',
      suggestion: 'Look for developer logo or company name in the PDF',
    });
  }

  if (data.address && data.address.trim().length > 5) {
    buildingScore += 7;
  } else {
    issues.push({
      severity: 'warning',
      field: 'address',
      message: 'Address is missing or incomplete',
      suggestion: 'Check location pages or contact information sections',
    });
  }

  if (data.completionDate) {
    buildingScore += 5;
  } else {
    issues.push({
      severity: 'info',
      field: 'completionDate',
      message: 'Completion date not found',
    });
  }

  totalScore += buildingScore;

  // 2. Unit Types (40 points)
  maxScore += 40;
  let unitsScore = 0;

  if (data.units && data.units.length > 0) {
    unitsScore += 15; // Base score for having units

    // Quality of unit data
    const completeUnits = data.units.filter(
      (unit) => unit.name && unit.bedrooms !== undefined && unit.area
    );

    const completenessRatio = completeUnits.length / data.units.length;
    unitsScore += Math.round(completenessRatio * 15); // Up to 15 points for complete unit data

    // Bonus for price data
    const unitsWithPrice = data.units.filter((unit) => unit.price && unit.price > 0);
    if (unitsWithPrice.length > 0) {
      unitsScore += Math.round((unitsWithPrice.length / data.units.length) * 10);
    }

    // Check for issues
    data.units.forEach((unit, idx) => {
      if (!unit.name) {
        issues.push({
          severity: 'warning',
          field: `units[${idx}].name`,
          message: `Unit ${idx + 1} is missing a name`,
        });
      }
      if (unit.bedrooms === undefined) {
        issues.push({
          severity: 'warning',
          field: `units[${idx}].bedrooms`,
          message: `Unit ${idx + 1} (${unit.name}) is missing bedroom count`,
        });
      }
      if (!unit.area) {
        issues.push({
          severity: 'warning',
          field: `units[${idx}].area`,
          message: `Unit ${idx + 1} (${unit.name}) is missing area`,
        });
      }
    });
  } else {
    issues.push({
      severity: 'critical',
      field: 'units',
      message: 'No unit types extracted',
      suggestion: 'Check if the PDF has floor plan pages with unit specifications',
    });
  }

  totalScore += unitsScore;

  // 3. Payment Plan (20 points)
  maxScore += 20;
  let paymentScore = 0;

  if (data.paymentPlans && data.paymentPlans.length > 0) {
    const plan = data.paymentPlans[0];
    
    if (plan.milestones && plan.milestones.length > 0) {
      paymentScore += 10;

      // Check total percentage
      if (Math.abs(plan.totalPercentage - 100) <= 5) {
        paymentScore += 10;
      } else {
        issues.push({
          severity: 'warning',
          field: 'paymentPlan.totalPercentage',
          message: `Payment plan percentages add up to ${plan.totalPercentage}% (expected 100%)`,
          suggestion: 'Review payment plan extraction for missing milestones',
        });
        paymentScore += 5; // Partial credit
      }
    }
  } else {
    issues.push({
      severity: 'warning',
      field: 'paymentPlans',
      message: 'No payment plan extracted',
      suggestion: 'Check if the PDF has payment schedule or installment plan pages',
    });
  }

  totalScore += paymentScore;

  // 4. Amenities (10 points)
  maxScore += 10;
  let amenitiesScore = 0;

  if (data.amenities && data.amenities.length > 0) {
    if (data.amenities.length >= 5) {
      amenitiesScore = 10;
    } else {
      amenitiesScore = Math.round((data.amenities.length / 5) * 10);
      issues.push({
        severity: 'info',
        field: 'amenities',
        message: `Only ${data.amenities.length} amenities extracted (expected 5+)`,
      });
    }
  } else {
    issues.push({
      severity: 'info',
      field: 'amenities',
      message: 'No amenities extracted',
    });
  }

  totalScore += amenitiesScore;

  // Calculate final score (out of 100)
  const finalScore = Math.round((totalScore / maxScore) * 100);

  // Determine overall validity
  const isValid = finalScore >= 60 && !issues.some((issue) => issue.severity === 'critical');

  return {
    isValid,
    score: finalScore,
    issues,
    completeness: {
      overall: finalScore,
      building: Math.round((buildingScore / 30) * 100),
      units: Math.round((unitsScore / 40) * 100),
      payment: Math.round((paymentScore / 20) * 100),
      amenities: Math.round((amenitiesScore / 10) * 100),
    },
  };
}

/**
 * Generate a human-readable quality report
 */
export function generateQualityReport(validation: ValidationResult): string {
  let report = `# Quality Assessment Report\n\n`;
  report += `**Overall Score**: ${validation.score}/100 ${validation.isValid ? '✅' : '⚠️'}\n\n`;

  report += `## Completeness Breakdown\n\n`;
  report += `- Building Information: ${validation.completeness.building}%\n`;
  report += `- Unit Types: ${validation.completeness.units}%\n`;
  report += `- Payment Plan: ${validation.completeness.payment}%\n`;
  report += `- Amenities: ${validation.completeness.amenities}%\n\n`;

  if (validation.issues.length > 0) {
    report += `## Issues Found (${validation.issues.length})\n\n`;

    const critical = validation.issues.filter((i) => i.severity === 'critical');
    const warnings = validation.issues.filter((i) => i.severity === 'warning');
    const info = validation.issues.filter((i) => i.severity === 'info');

    if (critical.length > 0) {
      report += `### 🔴 Critical Issues\n\n`;
      critical.forEach((issue) => {
        report += `- **${issue.field}**: ${issue.message}\n`;
        if (issue.suggestion) {
          report += `  - *Suggestion*: ${issue.suggestion}\n`;
        }
      });
      report += `\n`;
    }

    if (warnings.length > 0) {
      report += `### ⚠️ Warnings\n\n`;
      warnings.forEach((issue) => {
        report += `- **${issue.field}**: ${issue.message}\n`;
        if (issue.suggestion) {
          report += `  - *Suggestion*: ${issue.suggestion}\n`;
        }
      });
      report += `\n`;
    }

    if (info.length > 0) {
      report += `### ℹ️ Information\n\n`;
      info.forEach((issue) => {
        report += `- **${issue.field}**: ${issue.message}\n`;
      });
      report += `\n`;
    }
  } else {
    report += `## ✅ No Issues Found\n\nAll expected data was extracted successfully.\n`;
  }

  return report;
}
