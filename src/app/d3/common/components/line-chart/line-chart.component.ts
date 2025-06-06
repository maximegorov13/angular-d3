import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import * as d3 from 'd3';
import { LineChartDataItem } from '../../types';

const ruLocale = d3.timeFormatLocale({
  dateTime: '%A, %e %B %Y г. %X',
  date: '%d.%m.%Y',
  time: '%H:%M:%S',
  periods: ['AM', 'PM'],
  days: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  shortDays: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  months: [
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
  ],
  shortMonths: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
});

const fmtDay = ruLocale.format('%-d');
const fmtMY = ruLocale.format('%b %y');

@Component({
  selector: 'app-line-chart',
  standalone: true,
  imports: [],
  templateUrl: './line-chart.component.html',
  styleUrl: './line-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChartComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly data = input.required<LineChartDataItem[]>();

  private readonly chartCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');
  private readonly dzCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('dataZoomCanvas');

  private readonly brushSel = viewChild.required<ElementRef<HTMLDivElement>>('brushSel');
  private readonly handleLeft = viewChild.required<ElementRef<HTMLDivElement>>('handleLeft');
  private readonly handleRight = viewChild.required<ElementRef<HTMLDivElement>>('handleRight');

  private readonly width = signal(0);
  private readonly heightHost = signal(0);
  private readonly dzHeight = 40;
  private readonly chartHeight = computed(() => Math.max(0, this.heightHost() - this.dzHeight - 16 - 8));
  private readonly margin = {
    top: 8,
    right: 8,
    bottom: 32,
    left: 32,
  };

  private ctx = signal<CanvasRenderingContext2D | null>(null);
  private dzCtx = signal<CanvasRenderingContext2D | null>(null);

  private readonly zoomTransform = signal<d3.ZoomTransform>(d3.zoomIdentity);
  private readonly bx0 = signal<number>(this.margin.left);
  private readonly bx1 = signal<number>(this.width() - this.margin.right);

  private zoomBehavior!: d3.ZoomBehavior<HTMLCanvasElement, unknown>;

  private readonly baseXScale = computed(() =>
    d3
      .scaleUtc()
      .domain(d3.extent(this.data(), (d) => new Date(d.date)) as [Date, Date])
      .range([this.margin.left, this.width() - this.margin.right]),
  );

  private readonly xScale = computed(() => this.zoomTransform().rescaleX(this.baseXScale()));

  private readonly visibleData = computed(() => {
    const [x0, x1] = this.xScale().domain().map(Number);
    const data = this.data();

    const bisectDate = d3.bisector<LineChartDataItem, unknown>((d) => new Date(d.date)).left;

    const i0 = bisectDate(data, x0);
    const i1 = bisectDate(data, x1, i0);

    return data.slice(i0, i1);
  });

  private readonly visibleExtentY = computed<[number, number]>(() => {
    const [min, max] = d3.extent(this.visibleData(), (d) => d.value) as [number, number];

    if (min === undefined || max === undefined) {
      return [0, 1];
    }

    if (min === max) {
      return [min - 1, max + 1];
    }

    return [min, max];
  });

  private readonly yScale = computed(() =>
    d3
      .scaleLinear()
      .domain(this.visibleExtentY())
      .range([this.chartHeight() - this.margin.bottom, this.margin.top]),
  );

  private readonly allYScale = computed(() =>
    d3
      .scaleLinear()
      .domain(d3.extent(this.data(), (d) => d.value) as [number, number])
      .range([this.dzHeight, 0]),
  );

  private readonly xTicks = computed(() => this.xScale().ticks(this.width() / 100));

  private readonly yTicksValues = computed(() => {
    const [minY, maxY] = this.visibleExtentY();
    const maxLabels = 5;
    const fullTickCount = Math.max(2, Math.round((this.chartHeight() - this.margin.top - this.margin.bottom) / 40));
    const tickCount = Math.min(fullTickCount, maxLabels);
    const step = (maxY - minY) / (tickCount - 1);
    return Array.from({ length: tickCount }, (_, i) => minY + i * step);
  });

  constructor() {
    afterNextRender(() => {
      this.initChartCanvas();
      this.initDataZoomCanvas();
      this.initZoom();
      this.initBrush();
      this.observeHostResize();
    });

    effect(() => this.drawChart());
    effect(() => this.drawDataZoom());

    effect(() => this.syncBrushWithZoom());
    effect(() => this.syncZoomWithBrush());

    effect(() => {
      const w = this.width();
      const h = this.chartHeight();

      this.zoomBehavior
        .extent([
          [this.margin.left, 0],
          [w - this.margin.right, h],
        ])
        .translateExtent([
          [this.margin.left, 0],
          [w - this.margin.right, h],
        ]);
    });
  }

  private initChartCanvas(): void {
    const canvas = this.chartCanvas().nativeElement;
    canvas.width = this.width();
    canvas.height = this.chartHeight();
    this.ctx.set(canvas.getContext('2d'));
  }

  private initDataZoomCanvas(): void {
    const canvas = this.dzCanvas().nativeElement;
    canvas.width = this.width();
    canvas.height = this.dzHeight;
    this.dzCtx.set(canvas.getContext('2d') as CanvasRenderingContext2D);
  }

  private initZoom(): void {
    this.zoomBehavior = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 30])
      .translateExtent([
        [this.margin.left, 0],
        [this.width() - this.margin.right, this.chartHeight()],
      ])
      .extent([
        [this.margin.left, 0],
        [this.width() - this.margin.right, this.chartHeight()],
      ])
      .on('zoom', (event) => {
        this.zoomTransform.set(event.transform);
      });

    d3.select(this.chartCanvas().nativeElement).call(this.zoomBehavior);
  }

  private drawChart(): void {
    const ctx = this.ctx();
    if (!ctx) return;

    ctx.clearRect(0, 0, this.width(), this.chartHeight());

    this.drawGrid(ctx);
    this.drawAxes(ctx);
    this.drawDataLine(ctx);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    this.xTicks().forEach((t) => {
      const x = this.xScale()(t);
      ctx.moveTo(x, this.margin.top);
      ctx.lineTo(x, this.chartHeight() - this.margin.bottom);
    });
    this.yTicksValues().forEach((v) => {
      const y = this.yScale()(v);
      ctx.moveTo(this.margin.left, y);
      ctx.lineTo(this.width() - this.margin.right, y);
    });
    ctx.moveTo(this.width() - this.margin.right, this.margin.top);
    ctx.lineTo(this.width() - this.margin.right, this.chartHeight() - this.margin.bottom);
    ctx.strokeStyle = '#d4d7deff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawAxes(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    ctx.moveTo(this.margin.left, this.chartHeight() - this.margin.bottom);
    ctx.lineTo(this.width() - this.margin.right, this.chartHeight() - this.margin.bottom);
    ctx.moveTo(this.margin.left, this.margin.top);
    ctx.lineTo(this.margin.left, this.chartHeight() - this.margin.bottom);
    ctx.strokeStyle = '#d4d7deff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '10px Inter';
    ctx.fillStyle = '#7d8699ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    this.xTicks().forEach((date) => {
      const x = this.xScale()(date);
      const dayLabel = fmtDay(date);

      ctx.fillText(dayLabel, x, this.chartHeight() - this.margin.bottom + 8);

      if (date.getDate() === 1) {
        const monthYearLabel = fmtMY(date);
        ctx.fillText(monthYearLabel, x, this.chartHeight() - this.margin.bottom + 20);
      }
    });

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    this.yTicksValues().forEach((v) => {
      const y = this.yScale()(v);
      ctx.fillText(v.toFixed(0), this.margin.left - 8, y);
    });
  }

  private drawDataLine(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    const line = d3
      .line<LineChartDataItem>()
      .x((d) => this.xScale()(new Date(d.date)))
      .y((d) => this.yScale()(d.value));
    const path = line(this.visibleData());
    if (!path) return;
    const path2D = new Path2D(path);
    ctx.strokeStyle = '#3171eeff';
    ctx.lineWidth = 2;
    ctx.stroke(path2D);
  }

  private drawDataZoom(): void {
    const ctx = this.dzCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width(), this.dzHeight);

    ctx.beginPath();
    ctx.moveTo(this.margin.left, 0);
    ctx.lineTo(this.width() - this.margin.right, 0);
    ctx.moveTo(this.margin.left, this.dzHeight);
    ctx.lineTo(this.width() - this.margin.right, this.dzHeight);
    ctx.strokeStyle = '#d4d7de';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    const dzLine = d3
      .line<LineChartDataItem>()
      .x((d) => this.baseXScale()(new Date(d.date)))
      .y((d) => this.allYScale()(d.value));
    const path = dzLine(this.data());
    if (!path) return;
    const path2d = new Path2D(path);
    ctx.strokeStyle = '#3171eeff';
    ctx.lineWidth = 1;
    ctx.stroke(path2d);
  }

  private initBrush(): void {
    const sel = this.brushSel().nativeElement;
    const hl = this.handleLeft().nativeElement;
    const hr = this.handleRight().nativeElement;

    type Mode = 'move' | 'l' | 'r' | null;
    let mode: Mode = null;
    let grab = 0;
    let width = 0;

    const startDrag = (m: Mode) => (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      mode = m;
      const x0 = this.bx0();
      const x1 = this.bx1();
      const cx = e.clientX;

      if (m === 'move') {
        grab = cx - x0;
        width = x1 - x0;
      } else if (m === 'l') {
        grab = cx - x0;
      } else if (m === 'r') {
        grab = cx - x1;
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    const onMove = (e: MouseEvent) => {
      if (!mode) return;

      const min = this.margin.left;
      const max = this.width() - this.margin.right;
      let x0 = this.bx0();
      let x1 = this.bx1();
      const cx = e.clientX;

      switch (mode) {
        case 'move': {
          x0 = cx - grab;
          x1 = x0 + width;

          if (x0 < min) {
            x1 += min - x0;
            x0 = min;
          }

          if (x1 > max) {
            x0 -= x1 - max;
            x1 = max;
          }

          break;
        }

        case 'l': {
          x0 = Math.max(min, Math.min(cx - grab, max));
          break;
        }

        case 'r': {
          x1 = Math.max(min, Math.min(cx - grab, max));
          break;
        }
      }

      if (x0 > x1) {
        [x0, x1] = [x1, x0];
        mode = mode === 'l' ? 'r' : mode === 'r' ? 'l' : mode;
        grab = -grab;
      }

      this.setBrush(x0, x1);
    };

    const onUp = () => {
      mode = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    sel.addEventListener('mousedown', startDrag('move'));
    hl.addEventListener('mousedown', startDrag('l'));
    hr.addEventListener('mousedown', startDrag('r'));
  }

  private setBrush(x0: number, x1: number): void {
    this.bx0.set(x0);
    this.bx1.set(x1);

    const span = Math.abs(x1 - x0);
    if (!span) return;

    const full = this.width() - this.margin.left - this.margin.right;
    const k = full / span;
    const tx = this.margin.left - Math.min(x0, x1) * k;
    const t = d3.zoomIdentity.translate(tx, 0).scale(k);

    this.zoomTransform.set(t);
    d3.select(this.chartCanvas().nativeElement).call(this.zoomBehavior.transform, t);
  }

  private syncBrushWithZoom(): void {
    const l = Math.min(this.bx0(), this.bx1());
    const w = Math.abs(this.bx1() - this.bx0());

    const sel = this.brushSel().nativeElement;
    sel.style.left = `${l}px`;
    sel.style.width = `${w}px`;
  }

  private syncZoomWithBrush(): void {
    const [d0, d1] = this.xScale().domain();
    untracked(() => {
      this.bx0.set(this.baseXScale()(d0));
      this.bx1.set(this.baseXScale()(d1));
    });
  }

  private observeHostResize(): void {
    const ro = new ResizeObserver((entries) => {
      const [prevD0, prevD1] = this.xScale().domain();

      const { width, height } = entries[0].contentRect;
      this.width.set(width);
      this.heightHost.set(height);

      const chart = this.chartCanvas().nativeElement;
      const dz = this.dzCanvas().nativeElement;
      chart.width = width;
      chart.height = this.chartHeight();
      dz.width = width;
      dz.height = this.dzHeight;

      queueMicrotask(() => {
        const nx0 = this.baseXScale()(prevD0);
        const nx1 = this.baseXScale()(prevD1);
        this.setBrush(nx0, nx1);
      });
    });

    ro.observe(this.host.nativeElement);
  }
}
