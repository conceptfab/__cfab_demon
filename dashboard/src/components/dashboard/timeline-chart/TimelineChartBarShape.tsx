type BarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: { has_manual?: boolean };
  radius?: number | [number, number, number, number];
};

export function TimelineChartManualBarShape(props: unknown) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    fill,
    payload,
    radius,
  } = (props ?? {}) as BarShapeProps;
  if (height <= 0 || width <= 0) return null;
  const cornerRadius = Array.isArray(radius)
    ? (radius[0] ?? 0)
    : (radius ?? 0);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        rx={cornerRadius}
      />
      {payload?.has_manual && (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="url(#hatch)"
          rx={cornerRadius}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
}
