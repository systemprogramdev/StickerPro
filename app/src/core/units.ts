// Pure helpers, free of DOM APIs so they port with the matcher and planner.
export const M_PER_MILE = 1609.344
export const FT_PER_M = 3.28084

export const metersToMiles = (m: number) => m / M_PER_MILE
export const metersToFeet = (m: number) => m * FT_PER_M
