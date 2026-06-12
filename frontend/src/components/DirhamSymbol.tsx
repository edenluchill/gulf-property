/**
 * 阿联酋迪拉姆官方货币符号（2025 年央行发布）：
 * 大写 D 叠加两条水平横线（类似 € 的双横线）。
 * 目前无 Unicode 码位，用 SVG 绘制；fill=currentColor 跟随文字颜色。
 */
interface DirhamSymbolProps {
  /** 相对字号，默认 0.92em 与正文数字对齐 */
  size?: string
  className?: string
}

export default function DirhamSymbol({ size = '0.92em', className }: DirhamSymbolProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-0.1em' }}
      fill="currentColor"
      aria-label="AED"
      role="img"
    >
      {/* D 字主体 */}
      <text
        x="54"
        y="88"
        fontSize="98"
        fontWeight="700"
        fontFamily="Georgia, 'Times New Roman', serif"
        textAnchor="middle"
      >
        D
      </text>
      {/* 两条水平横线，向左伸出 D 的竖笔 */}
      <rect x="0" y="34" width="60" height="9" rx="4.5" />
      <rect x="0" y="55" width="60" height="9" rx="4.5" />
    </svg>
  )
}
