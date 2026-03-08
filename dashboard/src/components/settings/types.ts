type InlineInterpolationValue = string | number | boolean | null | undefined;
type InlineInterpolationMap = Record<string, InlineInterpolationValue>;

export type InlineT = (
  pl: string,
  en: string,
  interpolation?: InlineInterpolationMap,
) => string;
