import type { ReactNode } from 'react'

/** Biểu tượng trang trí, luôn đi cùng tên ứng dụng hoặc tiêu đề màn hình. */
export function Logo({ size = 32 }: { readonly size?: number }): ReactNode {
  return (
    <img
      className="brand-logo"
      src="/brand/logo.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  )
}
