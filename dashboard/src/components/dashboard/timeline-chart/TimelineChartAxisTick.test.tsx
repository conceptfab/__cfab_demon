import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TimelineChartAxisTick } from './TimelineChartAxisTick';
import type { StackedBarData } from '@/lib/db-types';

describe('TimelineChartAxisTick', () => {
  const chartDataByDate = new Map<string, StackedBarData>([
    [
      '2026-09-21',
      {
        date: '2026-09-21',
        comments: ['Test comment'],
        has_manual: true,
        has_boost: false,
      },
    ],
  ]);

  const xTickFormatter = (v: unknown) => `Formatted: ${v}`;

  it('returns null if coordinates are missing or invalid', () => {
    const { container: c1 } = render(
      <svg>
        <TimelineChartAxisTick
          x={0}
          y={0}
          payload={{ value: '2026-09-21' }}
          chartDataByDate={chartDataByDate}
          xTickFormatter={xTickFormatter}
        />
      </svg>,
    );
    expect(c1.querySelector('g')).toBeNull();

    const { container: c2 } = render(
      <svg>
        <TimelineChartAxisTick
          x={-10}
          y={150}
          payload={{ value: '2026-09-21' }}
          chartDataByDate={chartDataByDate}
          xTickFormatter={xTickFormatter}
        />
      </svg>,
    );
    expect(c2.querySelector('g')).toBeNull();

    const { container: c3 } = render(
      <svg>
        <TimelineChartAxisTick
          x={100}
          y={20} // y < 50
          payload={{ value: '2026-09-21' }}
          chartDataByDate={chartDataByDate}
          xTickFormatter={xTickFormatter}
        />
      </svg>,
    );
    expect(c3.querySelector('g')).toBeNull();
  });

  it('renders correctly with pure SVG and no foreignObject', () => {
    const { container } = render(
      <svg>
        <TimelineChartAxisTick
          x={120}
          y={180}
          payload={{ value: '2026-09-21' }}
          chartDataByDate={chartDataByDate}
          xTickFormatter={xTickFormatter}
        />
      </svg>,
    );

    expect(container.querySelector('foreignObject')).toBeNull();
    const textEl = container.querySelector('text');
    expect(textEl?.textContent).toBe('Formatted: 2026-09-21');

    const svgIcons = container.querySelectorAll('svg');
    // Root svg + 2 icons (MessageSquare + PenLine)
    expect(svgIcons.length).toBe(3);
  });

  it('renders SVG titles for tooltips and handles clicks', () => {
    const onBarClick = vi.fn();
    const { container } = render(
      <svg>
        <TimelineChartAxisTick
          x={120}
          y={180}
          payload={{ value: '2026-09-21' }}
          chartDataByDate={chartDataByDate}
          xTickFormatter={xTickFormatter}
          manualLabel="Custom Manual Label"
          onBarClick={onBarClick}
        />
      </svg>,
    );

    const titles = container.querySelectorAll('title');
    // 1 on text (date), 1 on comment icon, 1 on manual session icon
    expect(titles.length).toBe(3);
    const titleTexts = Array.from(titles).map((t) => t.textContent);
    expect(titleTexts).toContain('2026-09-21');
    expect(titleTexts.some((txt) => txt?.includes('Test comment'))).toBe(true);
    expect(titleTexts).toContain('Custom Manual Label');

    const commentGroup = container.querySelector('g[role="img"]');
    expect(commentGroup).not.toBeNull();
    fireEvent.click(commentGroup!);
    expect(onBarClick).toHaveBeenCalledWith('2026-09-21');
  });
});
