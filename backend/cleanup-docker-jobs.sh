#!/bin/bash

# Clean up old LangGraph jobs in Docker container
# Usage: docker-compose exec api sh /app/cleanup-docker-jobs.sh

UPLOADS_DIR="/app/uploads/langgraph-output"
KEEP_RECENT=3

echo "🧹 LangGraph Job Cleanup"
echo "========================"
echo ""

cd "$UPLOADS_DIR" || exit 1

# Count total jobs
TOTAL=$(find . -maxdepth 1 -type d -name "job_*" | wc -l)
echo "📁 Found $TOTAL job directories"

if [ "$TOTAL" -le "$KEEP_RECENT" ]; then
    echo "✅ All jobs are recent (keeping $TOTAL jobs)"
    exit 0
fi

# List jobs by date (newest first)
echo ""
echo "Keeping (most recent $KEEP_RECENT):"
find . -maxdepth 1 -type d -name "job_*" -printf '%T+ %p\n' | sort -r | head -n "$KEEP_RECENT" | while read -r line; do
    dir=$(echo "$line" | awk '{print $2}')
    size=$(du -sh "$dir" | awk '{print $1}')
    echo "  ✓ $(basename "$dir") - $size"
done

echo ""
echo "Will delete:"
TO_DELETE=$(find . -maxdepth 1 -type d -name "job_*" -printf '%T+ %p\n' | sort -r | tail -n +$((KEEP_RECENT + 1)) | awk '{print $2}')

if [ -z "$TO_DELETE" ]; then
    echo "  None"
    exit 0
fi

echo "$TO_DELETE" | while read -r dir; do
    size=$(du -sh "$dir" | awk '{print $1}')
    echo "  ✗ $(basename "$dir") - $size"
done

# Calculate total size to free
TOTAL_SIZE=$(echo "$TO_DELETE" | xargs du -sh | awk '{sum+=$1} END {print sum}')
echo ""
echo "Total space to free: ~${TOTAL_SIZE}M"

# Delete old jobs
echo ""
echo "Deleting old jobs..."
DELETED=0
echo "$TO_DELETE" | while read -r dir; do
    rm -rf "$dir"
    echo "  ✓ Deleted: $(basename "$dir")"
    DELETED=$((DELETED + 1))
done

echo ""
echo "✅ Cleanup complete!"
echo ""
