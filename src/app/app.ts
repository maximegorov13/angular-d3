import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LineChart, LineChartDataItem } from './d3';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, LineChart],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private http = inject(HttpClient);

  data = signal<LineChartDataItem[]>([]);

  ngOnInit(): void {
    this.http.get<any[]>('dataset.json').subscribe((res) => {
      this.data.set(
        res.map((d) => ({
          date: d.Date,
          value: d.Close,
        })),
      );
    });
  }
}
