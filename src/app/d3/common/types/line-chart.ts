export interface LineChartDataItem {
  date: string;
  value: number;
}

export interface LineChartSeries {
  data: LineChartDataItem[];
  color: string;
}

export interface LineChartData {
  series: LineChartSeries[];
}
