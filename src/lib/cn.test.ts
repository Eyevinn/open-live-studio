import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins truthy class values', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values from conditional expressions', () => {
    const isActive = false
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
    expect(cn('base', isActive && 'active')).toBe('base')
  })

  it('merges conflicting Tailwind utilities, keeping the last one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-sm text-red-500', 'text-lg')).toBe('text-red-500 text-lg')
  })
})
