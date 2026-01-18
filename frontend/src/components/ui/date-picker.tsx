import * as React from "react"
import { format, addYears } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Button } from "./button"
import { Input } from "./input"
import { cn } from "@/lib/utils"

interface DatePickerProps {
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  required?: boolean
  showPresets?: boolean
}

export function DatePicker({
  value,
  onChange,
  disabled = false,
  className,
  placeholder = "选择日期",
  required = false,
  showPresets = true,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(value || '')

  // Update input value when prop changes
  React.useEffect(() => {
    setInputValue(value || '')
  }, [value])

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return placeholder
    try {
      const date = new Date(dateStr)
      return format(date, 'yyyy-MM-dd')
    } catch {
      return dateStr
    }
  }

  const handleDateChange = (dateStr: string) => {
    setInputValue(dateStr)
    onChange(dateStr)
    setOpen(false)
  }

  const handlePresetClick = (yearsToAdd: number) => {
    const today = new Date()
    const futureDate = addYears(today, yearsToAdd)
    const formattedDate = format(futureDate, 'yyyy-MM-dd')
    handleDateChange(formattedDate)
  }

  const presets = [
    { label: '📅 今天', years: 0 },
    { label: '📆 1年后', years: 1 },
    { label: '🗓️ 2年后', years: 2 },
    { label: '📋 3年后', years: 3 },
    { label: '🎯 5年后', years: 5 },
    { label: '🚀 10年后', years: 10 },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-gray-500",
            disabled && "bg-amber-50 animate-pulse cursor-not-allowed",
            className
          )}
          type="button"
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {formatDisplayDate(value || '')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-4 space-y-4">
          {/* Date Input */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              选择日期
            </label>
            <Input
              type="date"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                onChange(e.target.value)
              }}
              className="w-full"
              required={required}
            />
          </div>

          {/* Presets */}
          {showPresets && (
            <>
              <div className="border-t pt-3">
                <label className="text-sm font-semibold text-gray-700 mb-2 block">
                  快捷选择
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {presets.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="sm"
                      onClick={() => handlePresetClick(preset.years)}
                      className="text-xs hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
                      type="button"
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Clear Button */}
              {value && (
                <div className="border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDateChange('')}
                    className="w-full text-red-600 hover:bg-red-50 hover:border-red-300"
                    type="button"
                  >
                    清除日期
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
