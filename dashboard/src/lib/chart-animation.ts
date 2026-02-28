type AnimationEasing = "ease-out";

export interface RechartsAnimationConfig {
  isAnimationActive: boolean;
  animationDuration: number;
  animationEasing: AnimationEasing;
}

interface RechartsAnimationOptions {
  complexity: number;
  maxComplexity: number;
  minDuration?: number;
  maxDuration?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getRechartsAnimationConfig({
  complexity,
  maxComplexity,
  minDuration = 170,
  maxDuration = 340,
}: RechartsAnimationOptions): RechartsAnimationConfig {
  if (!Number.isFinite(complexity) || complexity <= 0) {
    return { isAnimationActive: false, animationDuration: 0, animationEasing: "ease-out" };
  }
  if (!Number.isFinite(maxComplexity) || maxComplexity <= 0) {
    return { isAnimationActive: false, animationDuration: 0, animationEasing: "ease-out" };
  }
  if (prefersReducedMotion() || complexity > maxComplexity) {
    return { isAnimationActive: false, animationDuration: 0, animationEasing: "ease-out" };
  }

  const clampedMin = Math.max(80, Math.floor(minDuration));
  const clampedMax = Math.max(clampedMin, Math.floor(maxDuration));
  const ratio = Math.min(1, complexity / maxComplexity);
  const duration = Math.round(clampedMax - ratio * (clampedMax - clampedMin));

  return {
    isAnimationActive: true,
    animationDuration: duration,
    animationEasing: "ease-out",
  };
}
