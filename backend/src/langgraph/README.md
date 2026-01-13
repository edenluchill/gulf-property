# LangGraph Implementation Guide

## Quick Start

```typescript
import { executePdfWorkflow } from './langgraph/executor';

// Process a PDF
const result = await executePdfWorkflow({
  pdfPath: './brochure.pdf',
  simplified: false
});

console.log(result.buildingData);
```

## Architecture Overview

### State Management
- Uses LangGraph's `Annotation` for type-safe state
- State flows through all nodes with automatic merging
- Supports parallel processing with `Send` API

### Node Functions
- `ingestionNode`: PDF → Images
- `pageProcessorNode`: Classify + Extract (parallel)
- `aggregationNode`: Merge results
- `marketResearchNode`: External data
- `analysisNode`: Investment analysis
- `copywritingNode`: Marketing content

### Graph Flow

```
START → Ingestion → [Page 1, Page 2, ..., Page N] → Aggregation → Quality Check
                    (parallel processing)                             ↓
                                                                   Retry? → Yes → Ingestion
                                                                      ↓
                                                                     No
                                                                      ↓
                                                            Market Research → Analysis → Copywriting → END
```

## Key Features

### Parallel Processing
- All pages processed simultaneously
- Uses LangGraph's `Send` for fan-out
- Automatic result aggregation

### Quality Validation
- Manager agent checks data completeness
- Automatic retry on missing critical fields
- Max 2 retries to prevent infinite loops

### Error Handling
- Non-blocking errors (continues processing)
- Warnings for data quality issues
- Full error tracking in final result

## Customization

### Adding New Agents

1. Create agent file in `agents/`:
```typescript
export async function myNewAgent(input: any): Promise<any> {
  // Your logic here
}
```

2. Add node in `nodes.ts`:
```typescript
export async function myNewNode(state: State): Promise<Partial<State>> {
  const result = await myNewAgent(state.someData);
  return { someField: result };
}
```

3. Update graph in `graph.ts`:
```typescript
workflow.addNode('myNew', myNewNode);
workflow.addEdge('previousNode', 'myNew');
```

### Modifying Prompts

Prompts are in each agent file:
- `visual-classifier.agent.ts` - Page classification
- `floor-plan-auditor.agent.ts` - Floor plan extraction
- `financial-structurer.agent.ts` - Payment plans
- `market-intelligence.agent.ts` - Market research
- `copywriter.agent.ts` - Marketing content

### Schema Validation

Edit `schemas/property.schema.ts` to modify data structure:

```typescript
export const MyNewSchema = z.object({
  field1: z.string(),
  field2: z.number().optional(),
});
```

## Performance Tips

1. **Use simplified workflow** for testing:
   ```typescript
   executePdfWorkflow({ simplified: true })
   ```

2. **Limit image resolution** for faster processing (in `converter.ts`):
   ```typescript
   width: 1240,  // 150 DPI instead of 300
   height: 1754,
   ```

3. **Reduce parallel workers** if hitting rate limits:
   - Modify `createPageProcessingMap()` to batch pages

4. **Cache results** to avoid reprocessing:
   - Add Redis caching layer in executor

## Debugging

### Enable verbose logging:
```typescript
console.log('Current state:', JSON.stringify(state, null, 2));
```

### Check intermediate results:
```typescript
const result = await executePdfWorkflow({...});
console.log('Page results:', result.pageResults);
console.log('Categorized images:', result.categorizedImages);
```

### Test individual agents:
```typescript
import { classifyPage } from './agents/visual-classifier.agent';

const classification = await classifyPage('./test.png', 1);
console.log(classification);
```

## Common Issues

### Issue: "Canvas build failed"
**Solution**: Install with `--ignore-scripts` or use different Node version

### Issue: "API rate limit exceeded"
**Solution**: 
- Use simplified workflow
- Add delays between API calls
- Upgrade to paid Gemini plan

### Issue: "Missing unit data"
**Solution**:
- Check PDF quality (avoid scanned images)
- Adjust prompts in `floor-plan-auditor.agent.ts`
- Use full workflow with retries

## Testing Checklist

- [ ] PDF with clear floor plans
- [ ] PDF with payment plan tables
- [ ] PDF with multiple unit types
- [ ] Large PDF (20+ pages)
- [ ] Low-quality scanned PDF
- [ ] PDF with Arabic text
- [ ] Simplified workflow
- [ ] Full workflow with retries

## Resources

- LangGraph Docs: https://langchain-ai.github.io/langgraphjs/
- Gemini API: https://ai.google.dev/docs
- Zod: https://zod.dev/
