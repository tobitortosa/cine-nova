import { Component, input } from '@angular/core';

@Component({
  selector: 'app-vacio',
  imports: [],
  templateUrl: './vacio.component.html',
  styleUrl: './vacio.component.scss',
})
export class VacioComponent {
  readonly titulo = input<string>();
  readonly texto = input<string>('');
}
