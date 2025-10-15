import { Component } from '@angular/core';
import { ScanComponent } from './scan/scan.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ScanComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
