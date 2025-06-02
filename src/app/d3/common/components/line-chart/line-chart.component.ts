import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  signal,
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
  private readonly chartCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');
  private readonly dzCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('dataZoomCanvas');

  readonly data = input.required<LineChartDataItem[]>();

  private readonly width = 928;
  private readonly dzHeight = 40;
  private readonly height = 500;
  private readonly margin = {
    top: 8,
    right: 8,
    bottom: 32,
    left: 32,
  };

  private ctx = signal<CanvasRenderingContext2D | null>(null);
  private dzCtx = signal<CanvasRenderingContext2D | null>(null);

  private zoomBehavior!: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  private brushBehavior!: d3.BrushBehavior<unknown>;
  private readonly zoomTransform = signal<d3.ZoomTransform>(d3.zoomIdentity);

  private readonly baseXScale = computed(() =>
    d3
      .scaleUtc()
      .domain(d3.extent(this.data(), (d) => new Date(d.date)) as [Date, Date])
      .range([this.margin.left, this.width - this.margin.right]),
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
      .range([this.height - this.margin.bottom, this.margin.top]),
  );

  private readonly xTicks = computed(() => this.xScale().ticks(this.width / 100));

  private readonly yTicksValues = computed(() => {
    const [minY, maxY] = this.visibleExtentY();
    const maxLabels = 5;
    const fullTickCount = Math.max(2, Math.round((this.height - this.margin.top - this.margin.bottom) / 40));
    const tickCount = Math.min(fullTickCount, maxLabels);
    const step = (maxY - minY) / (tickCount - 1);
    return Array.from({ length: tickCount }, (_, i) => minY + i * step);
  });

  private readonly dzYScale = computed(() =>
    d3
      .scaleLinear()
      .domain(d3.extent(this.data(), (d) => d.value) as [number, number])
      .range([this.dzHeight, 0]),
  );

  constructor() {
    afterNextRender(() => {
      this.initChartCanvas();
      this.initDataZoomCanvas();
      this.initZoom();
    });

    effect(() => this.drawChart());
    effect(() => this.drawDataZoom());
  }

  private initChartCanvas(): void {
    const canvas = this.chartCanvas().nativeElement;
    canvas.width = this.width;
    canvas.height = this.height;
    this.ctx.set(canvas.getContext('2d'));
  }

  private initDataZoomCanvas(): void {
    const canvas = this.dzCanvas().nativeElement;
    canvas.width = this.width;
    canvas.height = this.dzHeight;
    this.dzCtx.set(canvas.getContext('2d') as CanvasRenderingContext2D);
  }

  private initZoom(): void {
    this.zoomBehavior = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 30])
      .translateExtent([
        [this.margin.left, 0],
        [this.width - this.margin.right, this.height],
      ])
      .extent([
        [this.margin.left, 0],
        [this.width - this.margin.right, this.height],
      ])
      .on('zoom', (event) => {
        this.zoomTransform.set(event.transform);
      });
    d3.select(this.chartCanvas().nativeElement).call(this.zoomBehavior);
  }

  private drawChart(): void {
    const ctx = this.ctx();
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.beginPath();
    this.xTicks().forEach((t) => {
      const x = this.xScale()(t);
      ctx.moveTo(x, this.margin.top);
      ctx.lineTo(x, this.height - this.margin.bottom);
    });
    this.yTicksValues().forEach((v) => {
      const y = this.yScale()(v);
      ctx.moveTo(this.margin.left, y);
      ctx.lineTo(this.width - this.margin.right, y);
    });
    ctx.moveTo(this.width - this.margin.right, this.margin.top);
    ctx.lineTo(this.width - this.margin.right, this.height - this.margin.bottom);
    ctx.strokeStyle = '#d4d7deff';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(this.margin.left, this.height - this.margin.bottom);
    ctx.lineTo(this.width - this.margin.right, this.height - this.margin.bottom);
    ctx.moveTo(this.margin.left, this.margin.top);
    ctx.lineTo(this.margin.left, this.height - this.margin.bottom);
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

      ctx.fillText(dayLabel, x, this.height - this.margin.bottom + 8);

      if (date.getDate() === 1) {
        const monthYearLabel = fmtMY(date);
        ctx.fillText(monthYearLabel, x, this.height - this.margin.bottom + 20);
      }
    });

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    this.yTicksValues().forEach((v) => {
      const y = this.yScale()(v);
      ctx.fillText(v.toFixed(0), this.margin.left - 8, y);
    });

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
    ctx.clearRect(0, 0, this.width, this.dzHeight);

    ctx.beginPath();
    ctx.moveTo(this.margin.left, 0);
    ctx.lineTo(this.width - this.margin.right, 0);
    ctx.moveTo(this.margin.left, this.dzHeight);
    ctx.lineTo(this.width - this.margin.right, this.dzHeight);
    ctx.strokeStyle = '#d4d7deff';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    const dzLine = d3
      .line<LineChartDataItem>()
      .x((d) => this.baseXScale()(new Date(d.date)))
      .y((d) => this.dzYScale()(d.value));
    const path = dzLine(this.data());
    if (!path) return;
    const path2d = new Path2D(path);
    ctx.strokeStyle = '#3171eeff';
    ctx.lineWidth = 1;
    ctx.stroke(path2d);
  }
}
