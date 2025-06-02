import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LineChartComponent, LineChartDataItem } from './d3';
import { HttpClient } from '@angular/common/http';
import { SpectrButtonComponent } from '@spectr-ui/components';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, LineChartComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
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
