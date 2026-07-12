import { useState } from 'react'

/**
 * 金额输入框(受控,raw 数字字符串)。
 * 铁律:聚焦时显示纯数字(无千分位)——每键实时插逗号会让 React 重设 value、
 * 光标跳结尾,中间插入/删除体验全毁(2026-07-07 用户实锤);失焦才格式化。
 * 默认价一律走 placeholder,绝不做 value 回退(否则删空会"弹回来删不完")。
 */
interface MoneyInputProps {
  /** 纯数字字符串('' = 空) */
  value: string
  onChange: (raw: string) => void
  placeholder?: string
  className?: string
  maxLen?: number
  disabled?: boolean
}

export default function MoneyInput({ value, onChange, placeholder, className, maxLen = 11, disabled }: MoneyInputProps) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      type="text"
      inputMode="numeric"
      value={focused ? value : (value ? Number(value).toLocaleString('en-US') : '')}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, maxLen))}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  )
}
