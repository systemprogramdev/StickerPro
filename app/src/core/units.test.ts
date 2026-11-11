import { describe, expect, it } from 'vitest'
import { metersToFeet, metersToMiles } from './units'

describe('units', () => {
  it('converts meters to miles', () => expect(metersToMiles(1609.344)).toBeCloseTo(1))
  it('converts meters to feet', () => expect(metersToFeet(100)).toBeCloseTo(328.084))
})
